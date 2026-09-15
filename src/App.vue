<script setup lang="ts">
  import { provide, computed, ref, watch, onMounted, onUnmounted } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { useTheme } from 'vuetify'
  import TopToolbar from './components/TopToolbar.vue'
  import Chessboard from './components/Chessboard.vue'
  import AnalysisSidebar from './components/AnalysisSidebar.vue'
  import DarkPiecePanel from './components/DarkPiecePanel.vue'
  import FlipPromptDialog from './components/FlipPromptDialog.vue'
  import FenInputDialog from './components/FenInputDialog.vue'
  import GameEndDialog from './components/GameEndDialog.vue'

  import { useChessGame } from './composables/useChessGame'
  import { useBoardViewState } from './composables/useBoardViewState'
  import { registerBoardFit, requestBoardFit } from './composables/useBoardFit'
  import { useUciEngine } from './composables/useUciEngine'
  import { useJaiEngine } from './composables/useJaiEngine'
  import { useInterfaceSettings } from './composables/useInterfaceSettings'
  import { useConfigManager } from './composables/useConfigManager'
  import { useAutosave } from './composables/useAutosave'
  import { useWindowManager } from './composables/useWindowManager'
  import { LANGUAGE_TO_HTML_LANG } from './utils/constants'

  const { locale } = useI18n()
  const configManager = useConfigManager()
  const theme = useTheme()

  // Get interface settings including dark mode
  const { showPositionChart, darkMode } = useInterfaceSettings()

  // Watch for dark mode changes and update theme
  watch(
    darkMode,
    newDarkMode => {
      theme.global.name.value = newDarkMode ? 'dark' : 'light'

      // Vuetify puts `.v-theme--dark` on `.v-application`, which is *inside*
      // <body>. Our own tokens paint <body> and <html>, so they would keep
      // reading the light values. Mirror the flag onto <html> to switch the
      // whole tree in one go.
      document.documentElement.dataset.theme = newDarkMode ? 'dark' : 'light'
      document.documentElement.style.colorScheme = newDarkMode
        ? 'dark'
        : 'light'
    },
    { immediate: true }
  )

  // Set HTML lang attribute based on current language
  const htmlLang = computed(() => {
    return LANGUAGE_TO_HTML_LANG[locale.value] || 'en-US'
  })

  // Watch for language changes and update HTML lang attribute
  watch(
    locale,
    newLocale => {
      const htmlLang = LANGUAGE_TO_HTML_LANG[newLocale] || 'en-US'
      document.documentElement.lang = htmlLang
      document.documentElement.setAttribute('lang', htmlLang)
    },
    { immediate: true }
  )

  const game = useChessGame()

  // Pass generateFen and gameState to ensure engine receives correct FEN format and can access game state
  const engine = useUciEngine(game.generateFen, game)
  const jaiEngine = useJaiEngine(game.generateFen, game)

  // Provide global state
  provide('game-state', game)
  provide('engine-state', engine)
  provide('jai-engine-state', jaiEngine)

  // Provide the FEN input dialog state from game state
  provide('fen-input-dialog-visible', game.isFenInputDialogVisible)

  // Set global engine state for useChessGame to access
  ;(window as any).__ENGINE_STATE__ = engine
  ;(window as any).__JAI_ENGINE__ = jaiEngine

  // Initialize autosave functionality after providing game state
  const autosave = useAutosave()

  // Initialize window manager for window size persistence
  const windowManager = useWindowManager()

  /**
   * Board maximised = the board keeps the whole screen. The hidden-piece
   * strip, the analysis deck and the nav bar all step aside; the toolbar
   * stays, because it is how you get back.
   */
  // Shared with the nav bar, which owns the toggle.
  const { isMaximised: boardMaximised } = useBoardViewState()

  /**
   * The board is a fixed 9:10 rectangle, so sizing it by width alone breaks on
   * a phone: the height runs out first and the board overflows its area.
   *
   * CSS cannot express "fit inside the parent on both axes while keeping the
   * ratio" — `aspect-ratio` is dropped the moment both axes are constrained,
   * which is exactly our case. So measure once per layout change.
   */
  const boardAreaEl = ref<HTMLElement | null>(null)
  let boardObserver: ResizeObserver | null = null

  /**
   * A *function* ref rather than `ref="boardAreaEl"`.
   *
   * With the string form under `<script setup>`, Vue assigns the element into
   * setupState under that name — overwriting the ref object itself. That left
   * `boardAreaEl.value` undefined, so `fitBoard` returned immediately on every
   * call and the board was never sized by height at all; it only ever looked
   * right because the fallback `width: 100%` happened to fit.
   */
  const setBoardAreaEl = (el: unknown) => {
    boardAreaEl.value = (el as HTMLElement) ?? null
  }

  const fitBoard = () => {
    const el = boardAreaEl.value
    if (!el) return
    const cs = getComputedStyle(el)
    const availW =
      el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
    const availH =
      el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)
    if (availW <= 0 || availH <= 0) return
    // The board is a fixed 9:10 rectangle, so the smaller of the two axes wins.
    el.style.setProperty(
      '--board-w',
      `${Math.floor(Math.min(availW, (availH * 9) / 10))}px`
    )
  }

  // Let the deck and the piece strip ask for a re-measure directly; see
  // useBoardFit for why the ResizeObserver alone is not enough.
  registerBoardFit(fitBoard)

  // Attach the observer as soon as the element exists, and re-fit whenever the
  // layout changes underneath it (deck dragged, pool folded, board maximised).
  const attachBoardObserver = () => {
    const el = boardAreaEl.value
    if (!el) return
    boardObserver?.disconnect()
    boardObserver = new ResizeObserver(fitBoard)
    boardObserver.observe(el)
    fitBoard()
  }

  watch(boardAreaEl, () => attachBoardObserver())

  watch([boardMaximised, showPositionChart], () => requestBoardFit())

  // Load configuration when app mounts
  onMounted(async () => {
    // The board must be measured before anything async delays this hook.
    attachBoardObserver()
    // Fonts and the board artwork can still shift the layout after mount, and
    // the ResizeObserver cannot be relied on to report it (its notifications
    // are skipped while the document is hidden). Re-fit once things settle.
    requestBoardFit()
    window.addEventListener('load', () => requestBoardFit(), { once: true })
    setTimeout(requestBoardFit, 350)

    try {
      await configManager.loadConfig()

      // Restore window state immediately after config is loaded for faster startup
      windowManager.restoreWindowState()

      // Set locale from config
      const savedLocale = configManager.getLocale()
      if (
        savedLocale &&
        ['zh_cn', 'zh_tw', 'en', 'vi', 'ja'].includes(savedLocale)
      ) {
        locale.value = savedLocale
      }

      // Check if engine list is empty and clear last selected engine ID if needed
      const engines = configManager.getEngines()
      if (engines.length === 0) {
        console.log(
          `[DEBUG] App: Engine list is empty on startup, clearing last selected engine ID`
        )
        await configManager.clearLastSelectedEngineId()
      }

      // Initialize autosave after configuration is loaded
      await autosave.initializeAutosave(game)
    } catch (error) {
      console.error('Failed to load configuration on app startup:', error)
    }
  })

  // Clean up autosave timer when app unmounts
  onUnmounted(() => {
    boardObserver?.disconnect()
    boardObserver = null
    autosave.stopAutosaveTimer()
    // Window manager cleanup is handled automatically by its own onUnmounted hook
  })
</script>

<template>
  <div class="app-container" :lang="htmlLang">
    <TopToolbar />

    <div class="app-body">
      <div class="app-main" :class="{ 'is-maximised': boardMaximised }">
        <div
          :ref="setBoardAreaEl"
          class="chessboard-area"
          :class="{ 'with-chart': showPositionChart }"
        >
          <Chessboard />
        </div>

        <DarkPiecePanel v-show="!boardMaximised" />

        <AnalysisSidebar />
      </div>
    </div>

    <FlipPromptDialog />
    <FenInputDialog
      v-model="game.isFenInputDialogVisible.value"
      @confirm="game.confirmFenInput"
    />
    <GameEndDialog
      :visible="game.isGameEndDialogVisible.value"
      :game-result="game.gameEndResult.value"
      :on-close="() => (game.isGameEndDialogVisible.value = false)"
    />
  </div>
</template>

<style lang="scss" scoped>
  /* The app is a fixed-height column: toolbar, then a body that fills the
     rest. Nothing scrolls as a whole — the deck scrolls inside itself, which
     is what keeps the board anchored instead of drifting up the page. */
  .app-container {
    display: flex;
    flex-direction: column;
    height: 100vh;
    height: 100dvh;
    overflow: hidden;
    background-color: rgb(var(--c-bg));
  }

  .app-body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: row;
    overflow: hidden;
  }

  .app-main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .chessboard-area {
    /* `flex-basis: 0`, not `auto`.
     *
     * With `auto` the area's size is derived from its content — and its content
     * is the board, whose height we compute *from* the area. That is a feedback
     * loop: measuring the board changes the box it was measured in. Basis 0
     * makes the area "whatever is left over", which depends only on the other
     * rows, so the measurement is stable. */
    flex: 1 1 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    /* Only a hairline of side padding: on a phone the board is limited by the
       screen width, so every pixel given to padding is a pixel off the board. */
    padding: var(--sp-2) 4px;
    overflow: hidden;

    /* --board-w is written by fitBoard(); the board's own component CSS sizes
       it from width, so constraining the wrapper is enough. */
    :deep(.chessboard-wrapper) {
      width: var(--board-w, 100%);
      max-width: none;
      margin: 0;
    }

    /* Position chart shrinks the board rather than pushing it off screen. */
    &.with-chart .chessboard-wrapper {
      transform: scale(0.75);
      transform-origin: top center;
    }

    @media (max-width: 768px) {
      &.with-chart .chessboard-wrapper {
        transform: none;
      }
    }
  }

  /* Board maximised: everything below the board steps aside. Keep the side
     padding tight — the board is width-limited on a phone, so any extra
     horizontal padding here would make it *smaller*, not bigger. */
  .app-main.is-maximised .chessboard-area {
    padding: var(--sp-2) 4px;
  }

  @media (min-width: 769px) {
    .chessboard-area {
      padding: var(--sp-4) var(--sp-5);
    }
  }
</style>
