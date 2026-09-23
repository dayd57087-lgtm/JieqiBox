<template>
  <div>
    <div class="scrim" :class="{ 'is-open': isOpen }" @click="close" />

    <aside class="drawer" :class="{ 'is-open': isOpen }" :aria-hidden="!isOpen">
      <header class="drawer__head">
        <span class="brand__mark">揭</span>
        <div class="drawer__ident">
          <b>{{ $t('toolbar.gameTitle') }}</b>
          <small>{{ engineSummary }}</small>
        </div>
        <button
          class="drawer__close"
          :aria-label="$t('drawer.close')"
          @click="close"
        >
          <svg viewBox="0 0 24 24" class="ico">
            <path d="M6 6l12 12M18 6L6 18" stroke-linecap="round" />
          </svg>
        </button>
      </header>

      <div class="drawer__scroll">
        <div
          v-for="group in groups"
          :key="group.labelKey"
          class="drawer__group"
        >
          <div class="drawer__label">{{ $t(group.labelKey) }}</div>

          <button
            v-for="item in group.items"
            :key="item.id"
            type="button"
            class="ditem"
            @click="activate(item)"
          >
            <svg viewBox="0 0 24 24" class="ico" v-html="item.path" />
            <span class="ditem__label">{{ $t(item.labelKey) }}</span>

            <span
              v-if="item.toggle === 'dark'"
              class="ditem__switch"
              :class="{ 'is-on': darkMode }"
            ></span>
            <span v-else-if="item.value" class="ditem__value">{{
              item.value
            }}</span>
          </button>
        </div>

        <!-- Panels that used to sit under the board. Hosted by whoever owns
             their state and passed in here, so the drawer stays a shell. -->
        <div v-if="$slots.extra" class="drawer__extra">
          <slot name="extra" />
        </div>
      </div>

      <footer class="drawer__foot">
        <button
          class="drawer__cta"
          :class="{ 'is-loaded': isEngineLoaded }"
          @click="$emit('toggle-engine')"
        >
          {{
            isEngineLoaded
              ? $t('analysis.unloadEngine')
              : $t('analysis.loadEngine')
          }}
        </button>
        <button class="drawer__ghost" @click="$emit('about')">
          {{ $t('analysis.about') }}
        </button>
      </footer>
    </aside>
  </div>
</template>

<script setup lang="ts">
  /**
   * Everything the main screen no longer has room for.
   *
   * The main screen is now board + hidden pieces + three analysis tabs. Rather
   * than delete the rest, all of it moved here: game files, engine setup,
   * tournament tools and interface options. Nothing is more than two taps away,
   * and the primary screen stays readable.
   */
  import { computed, inject } from 'vue'
  import { useInterfaceSettings } from '@/composables/useInterfaceSettings'

  defineProps<{ isOpen: boolean }>()

  const emit = defineEmits<{
    (e: 'close'): void
    (e: 'action', id: string): void
    (e: 'toggle-engine'): void
    (e: 'about'): void
  }>()

  const engineState = inject('engine-state') as any
  const { darkMode } = useInterfaceSettings()

  const isEngineLoaded = computed(() => !!engineState?.isEngineLoaded?.value)

  const engineSummary = computed(() => {
    const name = engineState?.currentEngine?.value?.name
    if (!isEngineLoaded.value) return '引擎 · 未加载'
    return `引擎 · ${name || '已加载'}`
  })

  const ICON = {
    edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z" stroke-linejoin="round"/>',
    save: '<path d="M5 3h11l3 3v15H5z" stroke-linejoin="round"/><path d="M9 3v6h6V3M9 14h6v7H9z" stroke-linejoin="round"/>',
    open: '<path d="M3 7h6l2 2h10v10H3z" stroke-linejoin="round"/>',
    clipboard:
      '<path d="M9 4h6v3H9zM6 5H4v16h16V5h-2" stroke-linejoin="round"/><path d="M8 12h8M8 16h5"/>',
    cogs: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
    cog: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
    timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 2h6"/>',
    console:
      '<path d="M3 5h18v14H3z" stroke-linejoin="round"/><path d="M7 10l3 3-3 3M13 16h4"/>',
    review:
      '<path d="M3 12a9 9 0 1 0 3-6.7" stroke-linecap="round"/><path d="M3 4v5h5" stroke-linejoin="round"/><path d="M12 8v4l3 2"/>',
    arrow:
      '<path d="M4 18L18 5M18 5h-5M18 5v5" stroke-linecap="round" stroke-linejoin="round"/>',
    book: '<path d="M4 5c3-1.5 6-1.5 8 0 2-1.5 5-1.5 8 0v13c-3-1.5-6-1.5-8 0-2-1.5-5-1.5-8 0z" stroke-linejoin="round"/><path d="M12 5v13"/>',
    tournament:
      '<path d="M7 4h10v4a5 5 0 0 1-10 0z" stroke-linejoin="round"/><path d="M12 13v4M8 20h8"/><path d="M7 6H4v2a4 4 0 0 0 4 4M17 6h3v2a4 4 0 0 1-4 4"/>',
    human:
      '<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0" stroke-linecap="round"/>',
    calc: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 12h2M12 12h2M16 12h.01M8 16h2M12 16h2M16 16h.01"/>',
    dashboard:
      '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="5" rx="1.5"/><rect x="13" y="10" width="8" height="11" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/>',
    moon: '<path d="M20 14a8.5 8.5 0 1 1-10-10 7 7 0 0 0 10 10z" stroke-linejoin="round"/>',
    lang: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z"/>',
    restore:
      '<path d="M3 12a9 9 0 1 0 3-6.7" stroke-linecap="round"/><path d="M3 4v5h5" stroke-linejoin="round"/>',
    log: '<path d="M4 4h16v16H4z" stroke-linejoin="round"/><path d="M8 9h8M8 13h8M8 17h5"/>',
    comment:
      '<path d="M4 5h16v11H9l-5 4z" stroke-linejoin="round"/><path d="M8 9h8M8 12h5"/>',
    board:
      '<path d="M3 3h18v18H3z" stroke-linejoin="round"/><path d="M9 3v18M15 3v18M3 9h18M3 15h18"/>',
    // Career: three rising steps — the ladder, read as a chart.
    ladder:
      '<path d="M4 20h16" stroke-linecap="round"/><path d="M5 20v-4h4v4M10 20v-8h4v8M15 20v-12h4v12" stroke-linejoin="round"/><path d="M18 8l1.5-2.5L21 8z" stroke-linejoin="round"/>',
  }

  type DrawerItem = {
    id: string
    labelKey: string
    path: string
    toggle?: string
    value?: string
  }

  const groups = computed<{ labelKey: string; items: DrawerItem[] }[]>(() => [
    {
      labelKey: 'drawer.groupGame',
      items: [
        {
          id: 'edit-position',
          labelKey: 'toolbar.editPosition',
          path: ICON.edit,
        },
        {
          id: 'save-notation',
          labelKey: 'toolbar.saveNotation',
          path: ICON.save,
        },
        {
          id: 'open-notation',
          labelKey: 'toolbar.openNotation',
          path: ICON.open,
        },
        {
          id: 'notation-text',
          labelKey: 'toolbar.viewPasteNotation',
          path: ICON.clipboard,
        },
        { id: 'copy-fen', labelKey: 'toolbar.copyFen', path: ICON.board },
      ],
    },
    {
      labelKey: 'drawer.groupPanels',
      items: [
        {
          id: 'comments',
          labelKey: 'analysis.moveComments',
          path: ICON.comment,
        },
        { id: 'engine-log', labelKey: 'analysis.engineLog', path: ICON.log },
      ],
    },
    {
      labelKey: 'drawer.groupEngine',
      items: [
        {
          id: 'engine-manager',
          labelKey: 'analysis.manageEngines',
          path: ICON.cogs,
        },
        { id: 'uci-options', labelKey: 'toolbar.uciSettings', path: ICON.cog },
        {
          id: 'time-settings',
          labelKey: 'toolbar.analysisParams',
          path: ICON.timer,
        },
        {
          id: 'uci-terminal',
          labelKey: 'analysis.uciTerminal',
          path: ICON.console,
        },
        { id: 'review', labelKey: 'toolbar.reviewAnalysis', path: ICON.review },
        {
          id: 'analyze-drawings',
          labelKey: 'toolbar.analyzeDrawings',
          path: ICON.arrow,
        },
      ],
    },
    {
      labelKey: 'drawer.groupTools',
      items: [
        {
          id: 'career',
          labelKey: 'career.menuEntry',
          path: ICON.ladder,
        },
        {
          id: 'opening-book',
          labelKey: 'toolbar.openingBook',
          path: ICON.book,
        },
        {
          id: 'match-mode',
          labelKey: 'analysis.enterMatchMode',
          path: ICON.tournament,
        },
        {
          id: 'human-vs-ai',
          labelKey: 'analysis.enterHumanVsAiMode',
          path: ICON.human,
        },
        { id: 'elo', labelKey: 'analysis.eloCalculator', path: ICON.calc },
      ],
    },
    {
      labelKey: 'drawer.groupInterface',
      items: [
        {
          id: 'interface-settings',
          labelKey: 'toolbar.interfaceSettings',
          path: ICON.dashboard,
        },
        {
          id: 'dark-mode',
          labelKey: 'toolbar.darkMode',
          path: ICON.moon,
          toggle: 'dark',
        },
        { id: 'language', labelKey: 'languages.current', path: ICON.lang },
        {
          id: 'restore-layout',
          labelKey: 'analysis.restorePanels',
          path: ICON.restore,
        },
      ],
    },
  ])

  const activate = (item: { id: string }) => {
    // The dark-mode row is its own little switch; let the parent own the
    // actual toggling so there is one source of truth for the theme.
    emit('action', item.id)
    if (item.id !== 'dark-mode') close()
  }

  const close = () => emit('close')
</script>

<style scoped lang="scss">
  .scrim {
    position: fixed;
    inset: 0;
    z-index: var(--z-sheet, 1200);
    background: var(--scrim, rgb(28 27 26 / 0.42));
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--dur-base) var(--ease-out);
  }

  .scrim.is-open {
    opacity: 1;
    pointer-events: auto;
  }

  .drawer {
    position: fixed;
    top: 0;
    bottom: 0;
    left: 0;
    z-index: calc(var(--z-sheet, 1200) + 1);
    width: min(304px, 84vw);
    display: flex;
    flex-direction: column;
    background: rgb(var(--c-surface));
    box-shadow: var(--sh-3);
    transform: translateX(-100%);
    transition: transform 220ms var(--ease-out);
  }

  .drawer.is-open {
    transform: none;
  }

  .drawer__head {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    padding: var(--sp-4) var(--sp-3);
    border-bottom: 1px solid rgb(var(--c-divider));
  }

  .brand__mark {
    width: 32px;
    height: 32px;
    display: grid;
    place-items: center;
    border-radius: var(--r-sm);
    background: rgb(var(--c-primary));
    color: rgb(var(--c-on-accent));
    font-size: var(--fs-md);
    font-weight: var(--fw-bold);
  }

  .drawer__ident {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .drawer__ident b {
    font-size: var(--fs-md);
    font-weight: var(--fw-semibold);
  }

  .drawer__ident small {
    font-size: var(--fs-micro);
    color: rgb(var(--c-text-3));
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .drawer__close {
    width: 44px;
    height: 44px;
    display: grid;
    place-items: center;
    border: none;
    border-radius: var(--r-sm);
    background: transparent;
    color: rgb(var(--c-text-3));
    cursor: pointer;
  }

  .drawer__close:active {
    background: rgb(var(--c-surface-3));
  }

  .drawer__scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: var(--sp-2) var(--sp-2) var(--sp-4);
  }

  .drawer__group {
    margin-top: var(--sp-3);
  }

  .drawer__group:first-child {
    margin-top: var(--sp-1);
  }

  .drawer__extra {
    margin-top: var(--sp-4);
    padding-top: var(--sp-2);
    border-top: 1px solid rgb(var(--c-divider));
  }

  .drawer__label {
    padding: 0 var(--sp-2) var(--sp-1);
    font-size: var(--fs-micro);
    font-weight: var(--fw-semibold);
    letter-spacing: 0.06em;
    color: rgb(var(--c-text-3));
  }

  .ditem {
    width: 100%;
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    min-height: 46px;
    padding: 0 var(--sp-2);
    border: none;
    border-radius: var(--r-sm);
    background: transparent;
    color: rgb(var(--c-text));
    font-size: var(--fs-base);
    text-align: left;
    cursor: pointer;
    transition: background var(--dur-fast) var(--ease-out);
  }

  .ditem:active {
    background: rgb(var(--c-surface-3));
  }

  .ditem .ico {
    width: 20px;
    height: 20px;
    flex: 0 0 auto;
    fill: none;
    stroke: rgb(var(--c-text-2));
    stroke-width: 1.7;
  }

  .ditem__label {
    flex: 1;
  }

  .ditem__value {
    font-size: var(--fs-sm);
    color: rgb(var(--c-text-3));
  }

  .ditem__switch {
    flex: 0 0 auto;
    width: 40px;
    height: 22px;
    position: relative;
    border-radius: var(--r-pill);
    background: rgb(var(--c-outline));
    transition: background var(--dur-base) var(--ease-out);
  }

  .ditem__switch::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 18px;
    height: 18px;
    border-radius: var(--r-pill);
    background: #fff;
    box-shadow: var(--sh-1);
    transition: translate var(--dur-base) var(--ease-out);
  }

  .ditem__switch.is-on {
    background: rgb(var(--c-primary));
  }

  .ditem__switch.is-on::after {
    translate: 18px 0;
  }

  .drawer__foot {
    flex: 0 0 auto;
    display: flex;
    gap: var(--sp-2);
    padding: var(--sp-3);
    padding-bottom: calc(var(--sp-3) + env(safe-area-inset-bottom));
    border-top: 1px solid rgb(var(--c-divider));
  }

  .drawer__cta {
    flex: 1;
    height: 44px;
    border: none;
    border-radius: var(--r-sm);
    background: rgb(var(--c-primary));
    color: rgb(var(--c-on-accent));
    font-size: var(--fs-base);
    font-weight: var(--fw-semibold);
    cursor: pointer;
  }

  .drawer__cta.is-loaded {
    background: rgb(var(--c-success));
  }

  .drawer__ghost {
    height: 44px;
    padding: 0 var(--sp-4);
    border: 1px solid rgb(var(--c-border));
    border-radius: var(--r-sm);
    background: transparent;
    color: rgb(var(--c-text-2));
    font-size: var(--fs-base);
    cursor: pointer;
  }
</style>
