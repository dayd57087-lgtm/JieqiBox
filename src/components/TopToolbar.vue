<template>
  <header class="top-toolbar">
    <!-- ── Row 1 · identity, engine status, overflow menu ────────────── -->
    <div class="tbar">
      <div class="brand">
        <span class="brand__mark" aria-hidden="true">揭</span>
        <span class="brand__name">{{ $t('toolbar.gameTitle') }}</span>
      </div>

      <span class="engine-pill" :class="enginePillClass">
        <span class="engine-pill__dot" aria-hidden="true"></span>
        <span class="engine-pill__text">{{ enginePillText }}</span>
      </span>

      <v-menu location="bottom end" :offset="6">
        <template #activator="{ props }">
          <button
            v-bind="props"
            type="button"
            class="icon-btn"
            :aria-label="$t('toolbar.menu.title')"
          >
            <i class="mdi mdi-dots-vertical"></i>
          </button>
        </template>

        <v-list density="compact" class="overflow-menu">
          <v-list-subheader>{{ $t('toolbar.menu.game') }}</v-list-subheader>
          <v-list-item
            prepend-icon="mdi-pencil-box-outline"
            :title="$t('toolbar.editPosition')"
            :disabled="isMatchRunning"
            @click="handleEditPosition"
          />
          <v-list-item
            prepend-icon="mdi-content-save-outline"
            :title="$t('toolbar.saveNotation')"
            :disabled="isMatchRunning"
            @click="handleSaveNotation"
          />
          <v-list-item
            prepend-icon="mdi-folder-open-outline"
            :title="$t('toolbar.openNotation')"
            :disabled="isMatchRunning"
            @click="handleOpenNotation"
          />
          <v-list-item
            prepend-icon="mdi-clipboard-text-outline"
            :title="$t('toolbar.viewPasteNotation')"
            :disabled="isMatchRunning"
            @click="showNotationTextDialog = true"
          />

          <v-divider class="my-1" />
          <v-list-subheader>{{ $t('toolbar.menu.engine') }}</v-list-subheader>
          <v-list-item
            prepend-icon="mdi-cog-outline"
            :title="$t('toolbar.uciSettings')"
            :disabled="isAnalyzing || !!engineState.isPondering?.value"
            @click="showUciOptionsDialog = true"
          />
          <v-list-item
            prepend-icon="mdi-timer-outline"
            :title="$t('toolbar.analysisParams')"
            @click="showTimeDialog = true"
          />
          <v-list-item
            prepend-icon="mdi-clipboard-pulse-outline"
            :title="$t('toolbar.reviewAnalysis')"
            :disabled="isMatchRunning || isAnalyzing"
            @click="showReviewDialog = true"
          />
          <v-list-item
            prepend-icon="mdi-ray-start-arrow"
            :title="$t('toolbar.analyzeDrawings')"
            :disabled="!isAnalyzeDrawingsAvailable"
            @click="handleAnalyzeDrawings"
          />

          <v-divider class="my-1" />
          <v-list-subheader>{{ $t('toolbar.menu.tools') }}</v-list-subheader>
          <v-list-item
            prepend-icon="mdi-book-open-variant"
            :title="$t('toolbar.openingBook')"
            @click="showOpeningBookDialog = true"
          />

          <v-divider class="my-1" />
          <v-list-subheader>{{
            $t('toolbar.menu.interface')
          }}</v-list-subheader>
          <v-list-item
            prepend-icon="mdi-view-dashboard-outline"
            :title="$t('toolbar.interfaceSettings')"
            @click="showInterfaceSettingsDialog = true"
          />
          <v-list-item
            :prepend-icon="darkMode ? 'mdi-weather-sunny' : 'mdi-weather-night'"
            :title="darkMode ? $t('toolbar.lightMode') : $t('toolbar.darkMode')"
            @click="toggleDarkMode"
          >
            <template #append>
              <v-switch
                :model-value="darkMode"
                color="primary"
                density="compact"
                hide-details
                class="menu-switch"
                @update:model-value="toggleDarkMode"
                @click.stop
              />
            </template>
          </v-list-item>

          <v-menu location="start" submenu open-on-hover>
            <template #activator="{ props: langProps }">
              <v-list-item
                v-bind="langProps"
                prepend-icon="mdi-translate"
                :title="$t('languages.current')"
                append-icon="mdi-chevron-right"
              />
            </template>
            <v-list density="compact" class="lang-menu">
              <v-list-item
                v-for="(name, code) in availableLanguages"
                :key="code"
                :title="name"
                :active="locale === code"
                :lang="String(code)"
                @click="changeLanguage(String(code))"
              />
            </v-list>
          </v-menu>
        </v-list>
      </v-menu>
    </div>

    <!-- ── Row 2 · the seven primary actions ─────────────────────────── -->
    <nav class="actions" :aria-label="$t('toolbar.menu.title')">
      <button
        type="button"
        class="act"
        :disabled="isMatchRunning"
        :title="$t('toolbar.newGame')"
        @click="setupNewGame"
      >
        <i class="mdi mdi-chess-king act__icon"></i>
        <span class="act__label">{{ $t('toolbar.core.newGame') }}</span>
      </button>

      <button
        type="button"
        class="act"
        :class="{ 'is-on': isRedAi }"
        :disabled="isMatchRunning || !isEngineLoaded || isManualAnalysis"
        :title="$t('toolbar.core.redComputer')"
        @click="toggleRedAi"
      >
        <span class="act__piece act__piece--red" aria-hidden="true"></span>
        <span class="act__label">{{ $t('toolbar.core.redComputer') }}</span>
      </button>

      <button
        type="button"
        class="act"
        :class="{ 'is-on': isBlackAi }"
        :disabled="isMatchRunning || !isEngineLoaded || isManualAnalysis"
        :title="$t('toolbar.core.blackComputer')"
        @click="toggleBlackAi"
      >
        <span class="act__piece act__piece--black" aria-hidden="true"></span>
        <span class="act__label">{{ $t('toolbar.core.blackComputer') }}</span>
      </button>

      <button
        type="button"
        class="act"
        :class="{ 'is-on': isAnalyzing || isPondering }"
        :disabled="isMatchRunning || !isEngineLoaded"
        :title="
          isAnalyzing || isPondering
            ? $t('analysis.stopAnalysis')
            : $t('analysis.startAnalysis')
        "
        @click="toggleAnalysis"
      >
        <i
          class="mdi act__icon"
          :class="
            isAnalyzing || isPondering
              ? 'mdi-stop-circle-outline'
              : 'mdi-magnify-scan'
          "
        ></i>
        <span class="act__label">{{
          isAnalyzing || isPondering
            ? $t('toolbar.core.stop')
            : $t('toolbar.core.analyze')
        }}</span>
      </button>

      <button
        type="button"
        class="act"
        :disabled="isMatchRunning || !isEngineLoaded"
        :title="$t('toolbar.core.moveNowHint')"
        @click="moveNow"
      >
        <i class="mdi mdi-step-forward act__icon"></i>
        <span class="act__label">{{ $t('toolbar.core.moveNow') }}</span>
      </button>

      <button
        type="button"
        class="act"
        :disabled="isMatchRunning || !isVariationAvailable"
        :title="$t('toolbar.variation')"
        @click="handleVariation"
      >
        <i class="mdi mdi-shuffle-variant act__icon"></i>
        <span class="act__label">{{ $t('toolbar.core.variation') }}</span>
      </button>

      <button
        type="button"
        class="act"
        :class="{ 'is-on': isBoardFlipped }"
        :title="
          isBoardFlipped
            ? $t('analysis.flipBoardBack')
            : $t('analysis.flipBoard')
        "
        @click="toggleBoardFlip()"
      >
        <i class="mdi mdi-flip-vertical act__icon"></i>
        <span class="act__label">{{ $t('toolbar.core.flip') }}</span>
      </button>
    </nav>

    <!-- ── Dialogs ───────────────────────────────────────────────────── -->
    <UciOptionsDialog
      v-model="showUciOptionsDialog"
      :engine-id="currentEngineId"
    />
    <TimeDialog
      v-model="showTimeDialog"
      @settings-changed="handleSettingsChanged"
    />
    <PositionEditorDialog
      v-model="showPositionEditor"
      @position-changed="handlePositionChanged"
    />
    <InterfaceSettingsDialog v-model="showInterfaceSettingsDialog" />
    <NotationTextDialog
      v-model="showNotationTextDialog"
      @apply="handleApplyNotationText"
    />
    <ReviewAnalysisDialog v-model="showReviewDialog" />
    <OpeningBookDialog v-model="showOpeningBookDialog" />
  </header>
</template>

<script setup lang="ts">
  import { ref, inject, computed, onUnmounted, watch } from 'vue'
  import { useI18n } from 'vue-i18n'
  import UciOptionsDialog from './UciOptionsDialog.vue'
  import TimeDialog from './TimeDialog.vue'
  import PositionEditorDialog from './PositionEditorDialog.vue'
  import InterfaceSettingsDialog from './InterfaceSettingsDialog.vue'
  import NotationTextDialog from './NotationTextDialog.vue'
  import ReviewAnalysisDialog from './ReviewAnalysisDialog.vue'
  import OpeningBookDialog from './OpeningBookDialog.vue'
  import { useInterfaceSettings } from '../composables/useInterfaceSettings'
  import { useAutoPlay } from '../composables/useAutoPlay'
  import { useConfigManager } from '../composables/useConfigManager'

  const { t, locale } = useI18n()
  const gameState: any = inject('game-state')
  const engineState: any = inject('engine-state')

  // Inject JAI engine state for tournament mode support
  const jaiEngine = inject('jai-engine-state') as any

  // Get dark mode setting from interface settings
  const { darkMode } = useInterfaceSettings()

  // Shared auto-play state + the actions owned by AnalysisSidebar
  const {
    isRedAi,
    isBlackAi,
    isManualAnalysis,
    toggleRedAi,
    toggleBlackAi,
    toggleAnalysis,
    moveNow,
  } = useAutoPlay()

  /* ---------- Language submenu ---------- */
  const configManager = useConfigManager()
  const availableLanguages = computed(() => ({
    zh_cn: t('languages.zh_cn'),
    zh_tw: t('languages.zh_tw'),
    en: t('languages.en'),
    vi: t('languages.vi'),
    ja: t('languages.ja'),
    ko: t('languages.ko'),
    ru: t('languages.ru'),
    de: t('languages.de'),
    fr: t('languages.fr'),
    es: t('languages.es'),
    th: t('languages.th'),
    ms: t('languages.ms'),
  }))

  const changeLanguage = async (langCode: string) => {
    locale.value = langCode
    try {
      await configManager.updateLocale(langCode)
    } catch (e) {
      console.warn('Failed to persist locale:', e)
    }
  }

  /* ---------- Engine status pill ---------- */
  const isEngineLoaded = computed(() => !!engineState.isEngineLoaded?.value)
  const isEngineLoading = computed(() => !!engineState.isEngineLoading?.value)
  const isThinking = computed(() => !!engineState.isThinking?.value)
  const isPondering = computed(() => !!engineState.isPondering?.value)
  const isStopping = computed(() => !!engineState.isStopping?.value)

  const enginePillClass = computed(() => ({
    'is-ready': isEngineLoaded.value && !isThinking.value && !isPondering.value,
    'is-busy': isThinking.value || isPondering.value,
    'is-loading': isEngineLoading.value || isStopping.value,
    'is-off': !isEngineLoaded.value && !isEngineLoading.value,
  }))

  const enginePillText = computed(() => {
    if (isEngineLoading.value) return t('toolbar.engine.loading')
    if (isStopping.value) return t('toolbar.engine.stopping')
    if (!isEngineLoaded.value) return t('toolbar.engine.none')
    if (isThinking.value || isPondering.value)
      return t('toolbar.engine.thinking')
    return t('toolbar.engine.ready')
  })

  /* ---------- Board flip ---------- */
  const isBoardFlipped = computed(() => !!gameState.isBoardFlipped?.value)
  const toggleBoardFlip = () => gameState.toggleBoardFlip?.()

  // Dialog states
  const showUciOptionsDialog = ref(false)
  const showTimeDialog = ref(false)
  const showPositionEditor = ref(false)
  const showInterfaceSettingsDialog = ref(false)
  const showNotationTextDialog = ref(false)
  const showReviewDialog = ref(false)
  const showOpeningBookDialog = ref(false)

  // State for variation restart logic
  const isWaitingToRestartForVariation = ref(false)
  const variationRestartData = ref<{ fen: string; moves: string[] } | null>(
    null
  )

  // Save/Open states
  const isSaving = ref(false)
  const isOpening = ref(false)
  const isApplyingText = ref(false)

  // Review analysis managed in ReviewAnalysisDialog

  // Analysis settings
  const analysisSettings = ref({
    movetime: 1000,
    maxThinkTime: 5000,
    maxDepth: 20,
    maxNodes: 1000000,
    analysisMode: 'movetime',
  })

  // Variation analysis state
  const excludedMoves = ref<string[]>([])
  // Drawings analysis state
  const isWaitingToRestartForDrawings = ref(false)
  const drawingsRestartData = ref<{ fen: string; moves: string[] } | null>(null)

  // Check if engine is currently analyzing (including pondering)
  const isAnalyzing = computed(() => engineState.isThinking?.value)

  // Check if match is running to disable certain interactions
  const isMatchRunning = computed(() => {
    return jaiEngine?.isMatchRunning?.value || false
  })

  // Get the currently loaded engine's ID
  const currentEngineId = computed(
    () => engineState.currentEngine?.value?.id || ''
  )

  // Computed property to determine if variation button should be enabled
  const isVariationAvailable = computed(
    () =>
      isAnalyzing.value &&
      engineState.pvMoves?.value?.length > 0 &&
      engineState.pvMoves.value[0]
  )

  // Enable drawings analysis only during analysis
  const isAnalyzeDrawingsAvailable = computed(() => isAnalyzing.value)

  // Toggle dark mode function
  const toggleDarkMode = () => {
    darkMode.value = !darkMode.value
  }

  // Handle variation button click
  const handleVariation = () => {
    console.log(`[DEBUG] Variation: Button clicked`)
    console.log(
      `[DEBUG] Variation: isAnalyzing=${isAnalyzing.value}, pvMoves=`,
      engineState.pvMoves?.value
    )

    if (!isAnalyzing.value || !engineState.pvMoves?.value?.length) {
      console.log(
        `[DEBUG] Variation: Early exit - not analyzing or no PV moves`
      )
      return
    }

    // Get the first move from current PV
    const firstPvMove = engineState.pvMoves.value[0]
    console.log(`[DEBUG] Variation: First PV move=${firstPvMove}`)
    if (!firstPvMove) {
      console.log(`[DEBUG] Variation: No first PV move available`)
      return
    }

    // Add to excluded moves list
    if (!excludedMoves.value.includes(firstPvMove)) {
      excludedMoves.value.push(firstPvMove)
    }
    console.log(`[DEBUG] Variation: Excluded moves list=`, excludedMoves.value)

    // Get all legal moves for current position
    const allLegalMoves = gameState.getAllLegalMovesForCurrentPosition()
    console.log(
      `[DEBUG] Variation: All legal moves (${allLegalMoves.length}):`,
      allLegalMoves
    )

    // Filter out excluded moves
    const allowedMoves = allLegalMoves.filter(
      (move: string) => !excludedMoves.value.includes(move)
    )
    console.log(
      `[DEBUG] Variation: Allowed moves after filtering (${allowedMoves.length}):`,
      allowedMoves
    )

    if (allowedMoves.length === 0) {
      alert(t('toolbar.noMoreVariations'))
      console.log(`[DEBUG] Variation: No allowed moves remaining`)
      return
    }

    console.log(
      `[DEBUG] Variation: Excluding move '${firstPvMove}', allowed moves:`,
      allowedMoves
    )

    // Set state to restart analysis once engine stops
    variationRestartData.value = {
      fen: gameState.generateFen(),
      moves: allowedMoves,
    }
    isWaitingToRestartForVariation.value = true

    // Stop current analysis first
    console.log(
      `[DEBUG] Variation: STOPPING current analysis to restart for variation.`
    )
    engineState.stopAnalysis({ playBestMoveOnStop: false })
  }

  // Handle analyze drawings button click
  const handleAnalyzeDrawings = () => {
    if (!isAnalyzing.value) return

    // 1) Get user-drawn arrow moves (UCI)
    const arrowMoves: string[] = gameState.getUserArrowMovesUci
      ? gameState.getUserArrowMovesUci()
      : []

    // 2) Get all legal moves for current position
    const allLegalMoves: string[] = gameState.getAllLegalMovesForCurrentPosition
      ? gameState.getAllLegalMovesForCurrentPosition()
      : []

    // 3) Intersect arrow moves with legal moves
    const arrowSet = new Set(arrowMoves)
    const filteredMoves = allLegalMoves.filter(m => arrowSet.has(m))

    if (filteredMoves.length === 0) {
      alert(t('toolbar.noDrawingMoves'))
      return
    }

    // 4) Prepare restart with restricted searchmoves
    drawingsRestartData.value = {
      fen: gameState.generateFen(),
      moves: filteredMoves,
    }
    isWaitingToRestartForDrawings.value = true

    // 5) Stop current analysis first
    engineState.stopAnalysis({ playBestMoveOnStop: false })
  }

  // Watch for engine to stop and handle variation restart or state reset
  watch(engineState.isThinking, (thinking, wasThinking) => {
    // Case 1: We were waiting for a variation restart, and the engine has now stopped.
    if (
      wasThinking &&
      !thinking &&
      isWaitingToRestartForVariation.value &&
      variationRestartData.value
    ) {
      console.log(
        `[DEBUG] Variation: Engine has stopped. RESTARTING analysis for variation.`
      )

      const { fen, moves } = variationRestartData.value

      const infiniteSettings = {
        movetime: 0,
        maxThinkTime: 0,
        maxDepth: 0,
        maxNodes: 0,
        analysisMode: 'infinite',
      }

      console.log(
        `[DEBUG] Variation: Starting infinite analysis with ${moves.length} searchmoves.`
      )
      engineState.startAnalysis(infiniteSettings, [], fen, moves)

      // Reset waiting state, but keep excludedMoves for the current variation sequence
      isWaitingToRestartForVariation.value = false
      variationRestartData.value = null
    }
    // Drawings analysis restart
    else if (
      wasThinking &&
      !thinking &&
      isWaitingToRestartForDrawings.value &&
      drawingsRestartData.value
    ) {
      const { fen, moves } = drawingsRestartData.value
      const infiniteSettings = {
        movetime: 0,
        maxThinkTime: 0,
        maxDepth: 0,
        maxNodes: 0,
        analysisMode: 'infinite',
      }
      engineState.startAnalysis(infiniteSettings, [], fen, moves)
      isWaitingToRestartForDrawings.value = false
      drawingsRestartData.value = null
    }
    // Case 2: Analysis has stopped for any other reason (e.g., manual stop, new game, etc.)
    // We check `!isWaitingToRestartForVariation` to avoid resetting during a variation sequence.
    else if (
      wasThinking &&
      !thinking &&
      !isWaitingToRestartForVariation.value
    ) {
      console.log(
        `[DEBUG] Variation: Analysis stopped. Resetting variation state.`
      )
      resetVariationState()
    }
  })

  // Reset all variation-related states
  const resetVariationState = () => {
    console.log(`[DEBUG] Variation: Full state reset initiated.`)
    excludedMoves.value = []
    isWaitingToRestartForVariation.value = false
    variationRestartData.value = null
    // Also clear any active searchmoves restrictions in the engine state
    if (engineState.clearSearchMoves) {
      console.log(
        `[DEBUG] Variation: Clearing searchmoves array in engine state.`
      )
      engineState.clearSearchMoves()
    }
    // Also reset drawings state
    isWaitingToRestartForDrawings.value = false
    drawingsRestartData.value = null
  }

  // Listen for position changes to reset variation state
  window.addEventListener('force-stop-ai', resetVariationState)

  // Handle edit position button click
  const handleEditPosition = () => {
    // Disable during match running
    if (isMatchRunning.value) {
      return
    }
    showPositionEditor.value = true
  }

  // New game - stop engine analysis before starting new game
  const setupNewGame = () => {
    // Disable during match running
    if (isMatchRunning.value) {
      return
    }
    // Stop engine analysis before starting new game to prevent continued thinking
    if (engineState.stopAnalysis) {
      engineState.stopAnalysis()
    }
    // Reset variation state when starting new game
    resetVariationState()
    gameState.setupNewGame()
  }

  // Save notation
  const handleSaveNotation = async () => {
    isSaving.value = true
    try {
      await gameState.saveGameNotation()
    } catch (error) {
      console.error(t('errors.saveNotationFailed'), error)
    } finally {
      isSaving.value = false
    }
  }

  // Open notation - stop engine analysis before loading new game
  const handleOpenNotation = () => {
    // Disable during match running
    if (isMatchRunning.value) {
      return
    }
    // Stop engine analysis before loading new game to prevent continued thinking
    if (engineState.stopAnalysis) {
      engineState.stopAnalysis()
    }
    // Reset variation state when opening notation
    resetVariationState()
    isOpening.value = true
    try {
      gameState.openGameNotation()
    } catch (error) {
      console.error(t('errors.openNotationFailed'), error)
    } finally {
      isOpening.value = false
    }
  }

  // Apply notation from pasted JSON text
  const handleApplyNotationText = async (text: string) => {
    if (isMatchRunning.value) return
    // Stop engine and reset variation state
    if (engineState.stopAnalysis) {
      engineState.stopAnalysis()
    }
    resetVariationState()
    isApplyingText.value = true
    try {
      await gameState.loadGameNotationFromText(text)
    } catch (error) {
      console.error(t('errors.openNotationFailed'), error)
    } finally {
      isApplyingText.value = false
    }
  }

  // Handle analysis settings changes
  const handleSettingsChanged = async (settings: any) => {
    // console.log('TopToolbar: 收到设置变化:', settings);
    analysisSettings.value = settings
    // Save to config file immediately to ensure AnalysisSidebar detects the change
    try {
      const { useConfigManager } = await import(
        '../composables/useConfigManager'
      )
      const configManager = useConfigManager()
      await configManager.updateAnalysisSettings(settings)
    } catch (error) {
      console.error('Failed to save analysis settings:', error)
    }
  }

  // Handle position changes - stop engine analysis when position is edited
  const handlePositionChanged = (
    _pieces: any[],
    _sideToMove: 'red' | 'black'
  ) => {
    // Stop engine analysis when position is edited to prevent continued thinking
    if (engineState.stopAnalysis) {
      engineState.stopAnalysis()
    }
    // Reset variation state when position changes
    resetVariationState()
    // Callback after position editing is complete
  }

  // Clean up event listener when component is unmounted
  onUnmounted(() => {
    window.removeEventListener('force-stop-ai', resetVariationState)
  })
</script>

<style lang="scss" scoped>
  .top-toolbar {
    position: sticky;
    top: 0;
    z-index: var(--z-sticky);
    padding-top: var(--safe-top);
    background: rgb(var(--c-surface));
    border-bottom: 1px solid rgb(var(--c-divider));
    box-shadow: var(--sh-1);
  }

  /* ── Row 1 ───────────────────────────────────────────────────────── */
  .tbar {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    height: var(--toolbar-h);
    padding: 0 var(--sp-2) 0 var(--sp-3);
  }

  .brand {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    min-width: 0;
    flex: 1;
  }

  .brand__mark {
    flex: 0 0 auto;
    width: 26px;
    height: 26px;
    display: grid;
    place-items: center;
    border-radius: var(--r-xs);
    background: rgb(var(--c-primary));
    color: rgb(var(--c-on-accent));
    font-size: var(--fs-base);
    font-weight: var(--fw-bold);
    line-height: 1;
  }

  .brand__name {
    font-size: var(--fs-md);
    font-weight: var(--fw-semibold);
    color: rgb(var(--c-text));
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Engine status reads as a quiet pill, not a button. */
  .engine-pill {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: var(--sp-1);
    height: 24px;
    padding: 0 var(--sp-2);
    border-radius: var(--r-pill);
    background: rgb(var(--c-surface-3));
    color: rgb(var(--c-text-2));
    font-size: var(--fs-micro);
    font-weight: var(--fw-medium);
    white-space: nowrap;
    transition: background var(--dur-base) var(--ease-out);

    &__dot {
      width: 6px;
      height: 6px;
      border-radius: var(--r-pill);
      background: rgb(var(--c-text-3));
    }

    &.is-ready {
      background: rgb(var(--c-success-soft));
      color: rgb(var(--c-success));

      .engine-pill__dot {
        background: rgb(var(--c-success));
      }
    }

    &.is-busy {
      background: rgb(var(--c-accent-soft));
      color: rgb(var(--c-accent));

      .engine-pill__dot {
        background: rgb(var(--c-accent));
        animation: pulse 1.2s var(--ease-out) infinite;
      }
    }

    &.is-loading {
      background: rgb(var(--c-info-soft));
      color: rgb(var(--c-info));

      .engine-pill__dot {
        background: rgb(var(--c-info));
        animation: pulse 1.2s var(--ease-out) infinite;
      }
    }
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
      transform: scale(1);
    }
    50% {
      opacity: 0.35;
      transform: scale(0.7);
    }
  }

  .icon-btn {
    flex: 0 0 auto;
    width: 36px;
    height: 36px;
    display: grid;
    place-items: center;
    border: none;
    border-radius: var(--r-sm);
    background: transparent;
    color: rgb(var(--c-text-2));
    font-size: 20px;
    cursor: pointer;
    transition: background var(--dur-fast) var(--ease-out);

    &:hover {
      background: rgb(var(--c-surface-3));
    }

    &:active {
      background: rgb(var(--c-border));
    }
  }

  /* ── Row 2 — the seven primary actions ───────────────────────────── */
  .actions {
    display: flex;
    align-items: stretch;
    gap: 2px;
    padding: var(--sp-1) var(--sp-2) var(--sp-2);
    border-top: 1px solid rgb(var(--c-divider) / 0.6);
    overflow-x: auto;
    scrollbar-width: none;

    &::-webkit-scrollbar {
      display: none;
    }
  }

  .act {
    flex: 1 1 0;
    min-width: 52px;
    height: 50px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    padding: 0 2px;
    border: none;
    border-radius: var(--r-sm);
    background: transparent;
    color: rgb(var(--c-text-2));
    cursor: pointer;
    -webkit-user-select: none;
    user-select: none;
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out),
      transform var(--dur-fast) var(--ease-out);

    &:hover:not(:disabled) {
      background: rgb(var(--c-surface-3));
      color: rgb(var(--c-text));
    }

    &:active:not(:disabled) {
      transform: scale(0.95);
    }

    &:disabled {
      opacity: 0.34;
      cursor: default;
    }

    /* Active / engaged state — soft tint, no shouting. */
    &.is-on {
      background: rgb(var(--c-primary-soft));
      color: rgb(var(--c-primary-text));
    }

    &__icon {
      font-size: 20px;
      line-height: 1;
    }

    &__label {
      font-size: var(--fs-micro);
      line-height: 1;
      font-weight: var(--fw-medium);
      white-space: nowrap;
    }

    /* The red / black army marker: hollow ring when off, filled when on. */
    &__piece {
      position: relative;
      width: 18px;
      height: 18px;
      border-radius: var(--r-pill);
      border: 2px solid currentColor;
      transition:
        box-shadow var(--dur-base) var(--ease-out),
        border-color var(--dur-base) var(--ease-out);

      &::after {
        content: '';
        position: absolute;
        inset: 2.5px;
        border-radius: var(--r-pill);
        background: currentColor;
        opacity: 0;
        transform: scale(0.4);
        transition:
          opacity var(--dur-base) var(--ease-out),
          transform var(--dur-base) var(--ease-spring);
      }

      &--red {
        color: rgb(var(--c-side-red));
      }

      &--black {
        color: rgb(var(--c-side-black));
      }
    }

    &.is-on &__piece {
      box-shadow: 0 0 0 3px currentColor;
      box-shadow: 0 0 0 3px rgb(var(--c-primary) / 0.16);

      &::after {
        opacity: 1;
        transform: scale(1);
      }
    }
  }

  /* ── Overflow menu ───────────────────────────────────────────────── */
  :deep(.overflow-menu) {
    min-width: 232px;
    max-height: min(70vh, 560px);
    overflow-y: auto;
  }

  :deep(.overflow-menu .v-list-subheader) {
    font-size: var(--fs-micro);
    font-weight: var(--fw-semibold);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: rgb(var(--c-text-3));
    min-height: 32px;
  }

  :deep(.lang-menu) {
    min-width: 160px;
    max-height: 60vh;
    overflow-y: auto;
  }

  :deep(.menu-switch) {
    flex: 0 0 auto;
    margin: 0;

    .v-selection-control {
      min-height: 0;
    }
  }

  /* ── Desktop: collapse the two rows into one ─────────────────────── */
  @media (min-width: 900px) {
    .top-toolbar {
      display: flex;
      align-items: center;
      gap: var(--sp-4);
      padding: var(--sp-2) var(--sp-4);
      height: 64px;
    }

    .tbar {
      flex: 1;
      height: auto;
      padding: 0;
      gap: var(--sp-3);
    }

    .brand {
      flex: 0 0 auto;
    }

    .actions {
      flex: 0 0 auto;
      padding: 0;
      border-top: none;
      gap: var(--sp-1);
      overflow: visible;
    }

    .act {
      flex: 0 0 auto;
      min-width: 64px;
      height: 48px;
    }
  }
</style>
