<template>
  <section
    class="deck"
    :class="{ 'is-collapsed': collapsed, 'is-dragging': dragging }"
    :style="{ height: effectiveHeight + 'px' }"
  >
    <!-- Drag to set the height; a tap (no movement) folds it. -->
    <div
      ref="gripEl"
      class="deck__grip"
      role="separator"
      aria-orientation="horizontal"
      :aria-label="$t('deck.resizeHint')"
      :title="$t('deck.resizeHint')"
      @pointerdown="onGripDown"
    >
      <span class="deck__grip-bar" aria-hidden="true"></span>
    </div>

    <!-- Folded: one line of what matters right now. -->
    <div v-if="collapsed" class="deck__summary">
      <div class="deck__summary-main">
        <slot name="summary" />
      </div>
      <button
        type="button"
        class="deck__toggle"
        :aria-expanded="false"
        :title="$t('deck.expand')"
        @click="toggleCollapsed"
      >
        <i class="mdi mdi-chevron-up"></i>
      </button>
    </div>

    <template v-else>
      <div class="deck__tabs">
        <div class="tabs" role="tablist">
          <button
            v-for="tab in TABS"
            :key="tab.id"
            type="button"
            role="tab"
            class="tab"
            :class="{ 'is-active': active === tab.id }"
            :aria-selected="active === tab.id"
            @click="select(tab.id)"
          >
            {{ $t(tab.labelKey) }}
          </button>
        </div>

        <div class="segmented" role="group">
          <button
            v-for="d in DENSITIES"
            :key="d.id"
            type="button"
            :class="{ 'is-active': density === d.id }"
            @click="density = d.id"
          >
            {{ $t(d.labelKey) }}
          </button>
        </div>

        <button
          type="button"
          class="deck__toggle"
          :aria-expanded="true"
          :title="$t('deck.collapse')"
          @click="toggleCollapsed"
        >
          <i class="mdi mdi-chevron-down"></i>
        </button>
      </div>

      <div class="deck__body">
        <div
          v-for="tab in TABS"
          :key="tab.id"
          class="pane"
          :class="{ 'is-active': active === tab.id }"
          role="tabpanel"
        >
          <slot :name="tab.id" />
        </div>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
  /**
   * Bottom deck — 分析 / 开局库 / 导航.
   *
   * A shell: it owns which tab is showing, how tall it is, and whether it is
   * folded. The panes are slots, so each keeps living in the component that
   * owns its logic rather than being torn apart to be re-parented here. The
   * folded one-liner is a slot too, because only the owner knows what is worth
   * summarising.
   *
   * Why the height is user-controlled: the board and this deck compete for the
   * same column of pixels, and only the person playing knows whether they would
   * rather read the analysis or see the board.
   */
  import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
  import { requestBoardFit } from '@/composables/useBoardFit'

  export type DeckTab = 'analysis' | 'book' | 'nav'
  export type DeckDensity = 'standard' | 'compact'

  const TABS: { id: DeckTab; labelKey: string }[] = [
    { id: 'analysis', labelKey: 'deck.analysis' },
    { id: 'book', labelKey: 'deck.book' },
    { id: 'nav', labelKey: 'deck.nav' },
  ]

  const DENSITIES: { id: DeckDensity; labelKey: string }[] = [
    { id: 'standard', labelKey: 'deck.standard' },
    { id: 'compact', labelKey: 'deck.compact' },
  ]

  /* ---------- Geometry ---------- */

  /** Just the grip plus one line of text. */
  const COLLAPSED_H = 46
  /** Grip + tab row + enough rows to be useful. */
  const MIN_H = 118
  /**
   * The deck never takes more than this share of the screen.
   *
   * Half, so the board always keeps a usable share of the column. Beyond that
   * the board shrinks faster than it looks (it is a 9:10 rectangle, so losing
   * 10% of the width costs 10% of the height too) and becomes hard to read.
   */
  const MAX_SHARE = 0.5
  const DEFAULT_H = 206

  /** Below this, a press counts as a tap rather than a drag. */
  const TAP_SLOP = 6

  const TABS_KEY = 'jieqi.deck'
  const LAYOUT_KEY = 'jieqi.deck.layout'

  const readJson = <T,>(key: string): T | null => {
    try {
      const raw = localStorage.getItem(key)
      return raw ? (JSON.parse(raw) as T) : null
    } catch {
      return null
    }
  }

  const storedTabs = readJson<{ tab?: DeckTab; density?: DeckDensity }>(
    TABS_KEY
  )
  const storedLayout = readJson<{ height?: number; collapsed?: boolean }>(
    LAYOUT_KEY
  )

  const active = ref<DeckTab>(storedTabs?.tab ?? 'analysis')
  const density = ref<DeckDensity>(storedTabs?.density ?? 'standard')

  const collapsed = ref(storedLayout?.collapsed ?? false)
  const height = ref(storedLayout?.height ?? DEFAULT_H)
  const dragging = ref(false)

  /** Read reactively so a rotation re-clamps the maximum. */
  const viewportH = ref(
    typeof window === 'undefined' ? 900 : window.innerHeight
  )

  const maxHeight = computed(() =>
    Math.max(MIN_H, Math.floor(viewportH.value * MAX_SHARE))
  )

  const effectiveHeight = computed(() =>
    collapsed.value
      ? COLLAPSED_H
      : Math.min(Math.max(height.value, MIN_H), maxHeight.value)
  )

  const persistLayout = () => {
    try {
      localStorage.setItem(
        LAYOUT_KEY,
        JSON.stringify({ height: height.value, collapsed: collapsed.value })
      )
    } catch {
      // The deck still works, it just forgets where it was left.
    }
  }

  const persistTabs = () => {
    try {
      localStorage.setItem(
        TABS_KEY,
        JSON.stringify({ tab: active.value, density: density.value })
      )
    } catch {
      // Same as above.
    }
  }

  const select = (id: DeckTab) => {
    active.value = id
    persistTabs()
  }

  const toggleCollapsed = () => {
    collapsed.value = !collapsed.value
    persistLayout()
  }

  /* ---------- Drag to resize ---------- */

  const gripEl = ref<HTMLElement | null>(null)
  let startY = 0
  let startH = 0
  let moved = false

  /**
   * The deck sits at the bottom of the column, so dragging *up* makes it
   * taller. Pointer capture keeps the gesture alive once the finger leaves the
   * 16px handle, which it inevitably will.
   */
  const onGripDown = (e: PointerEvent) => {
    if (e.button !== 0) return

    startY = e.clientY
    startH = effectiveHeight.value
    moved = false
    dragging.value = true
    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
    } catch {
      // Capture is an optimisation: without it the gesture still tracks, it
      // just stops following the pointer outside the handle.
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
  }

  const onPointerMove = (e: PointerEvent) => {
    if (!dragging.value) return
    const dy = startY - e.clientY

    if (!moved && Math.abs(dy) < TAP_SLOP) return
    moved = true

    // Dragging is an explicit request for a sized deck, so it unfolds.
    if (collapsed.value) collapsed.value = false

    height.value = Math.min(Math.max(startH + dy, MIN_H), maxHeight.value)
  }

  const onPointerUp = (e: PointerEvent) => {
    if (!dragging.value) return
    dragging.value = false

    try {
      gripEl.value?.releasePointerCapture?.(e.pointerId)
    } catch {
      // Already released, or never captured.
    }

    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', onPointerUp)

    // A press that never moved is a tap: fold it.
    if (!moved) collapsed.value = !collapsed.value

    persistLayout()
  }

  /* ---------- Side effects ---------- */

  // The board shares this column, so every change in deck height is a change
  // in how much room the board has.
  // `post`: the measurement inside requestBoardFit reads the DOM, so it must
  // run after this component has re-rendered with the new height.
  watch(effectiveHeight, () => requestBoardFit(), { flush: 'post' })

  watch(
    density,
    () => {
      document.body.dataset.deckDensity = density.value
      persistTabs()
    },
    { immediate: true }
  )

  const onResize = () => {
    viewportH.value = window.innerHeight
    // Re-clamp, so a shrunken viewport cannot leave the deck oversized.
    if (height.value > maxHeight.value) {
      height.value = maxHeight.value
      persistLayout()
    }
  }

  onMounted(() => window.addEventListener('resize', onResize))

  onBeforeUnmount(() => {
    window.removeEventListener('resize', onResize)
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', onPointerUp)
  })

  defineExpose({ select, toggleCollapsed })
</script>

<style scoped lang="scss">
  .deck {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    margin: 0 var(--sp-2) var(--sp-2);
    border: 1px solid rgb(var(--c-border));
    border-radius: var(--r-md);
    background: rgb(var(--c-surface));
    box-shadow: var(--sh-1);
    overflow: hidden;
    /* The fold animates; a drag must not, or it lags behind the finger. */
    transition: height var(--dur-base) var(--ease-out);
  }

  .deck.is-dragging {
    transition: none;
    user-select: none;
  }

  /* ── Grip ───────────────────────────────────────────────────────── */
  .deck__grip {
    flex: 0 0 auto;
    height: 16px;
    display: grid;
    place-items: center;
    cursor: grab;
    /* The gesture is ours, not the browser's. */
    touch-action: none;
  }

  .deck.is-dragging .deck__grip {
    cursor: grabbing;
  }

  .deck__grip-bar {
    width: 40px;
    height: 4px;
    border-radius: var(--r-pill);
    background: rgb(var(--c-outline));
    transition: background var(--dur-fast) var(--ease-out);
  }

  .deck__grip:hover .deck__grip-bar,
  .deck.is-dragging .deck__grip-bar {
    background: rgb(var(--c-primary));
  }

  /* ── Folded one-liner ───────────────────────────────────────────── */
  .deck__summary {
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    padding: 0 var(--sp-2) 0 var(--sp-3);
  }

  .deck__summary-main {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    font-size: var(--fs-base);
    white-space: nowrap;
    overflow: hidden;
  }

  /* ── Tab row ────────────────────────────────────────────────────── */
  .deck__tabs {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    padding: 2px var(--sp-1) 2px var(--sp-3);
    border-bottom: 1px solid rgb(var(--c-divider));
  }

  .tabs {
    flex: 1;
    display: flex;
    gap: 2px;
    min-width: 0;
  }

  .tab {
    position: relative;
    min-width: 52px;
    padding: 9px;
    border: none;
    background: transparent;
    color: rgb(var(--c-text-2));
    font-size: var(--fs-md);
    font-weight: var(--fw-medium);
    cursor: pointer;
    transition: color var(--dur-base) var(--ease-out);
  }

  /* Grow the hit area to the 44px touch floor without touching the layout —
     the strip is already tight against the board's vertical budget. */
  .tab::before {
    content: '';
    position: absolute;
    inset: -3px -4px;
  }

  .tab.is-active {
    color: rgb(var(--c-text));
    font-weight: var(--fw-semibold);
  }

  .tab.is-active::after {
    content: '';
    position: absolute;
    left: 50%;
    bottom: 2px;
    translate: -50% 0;
    width: 4px;
    height: 4px;
    border-radius: var(--r-pill);
    background: rgb(var(--c-primary));
  }

  .segmented {
    flex: 0 0 auto;
    display: flex;
    padding: 2px;
    border-radius: var(--r-pill);
    background: rgb(var(--c-surface-3));
  }

  .segmented button {
    height: 32px;
    padding: 0 12px;
    border: none;
    border-radius: var(--r-pill);
    background: transparent;
    color: rgb(var(--c-text-2));
    font-size: var(--fs-sm);
    font-weight: var(--fw-medium);
    cursor: pointer;
    transition:
      background var(--dur-base) var(--ease-out),
      color var(--dur-base) var(--ease-out);
  }

  .segmented button.is-active {
    background: rgb(var(--c-primary));
    color: rgb(var(--c-on-accent));
  }

  .deck__toggle {
    flex: 0 0 auto;
    width: 34px;
    height: 34px;
    display: grid;
    place-items: center;
    border: none;
    border-radius: var(--r-sm);
    background: transparent;
    color: rgb(var(--c-text-3));
    font-size: 20px;
    cursor: pointer;
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  .deck__toggle:hover {
    background: rgb(var(--c-surface-3));
    color: rgb(var(--c-text));
  }

  /* ── Panes ──────────────────────────────────────────────────────── */
  .deck__body {
    flex: 1;
    min-height: 0;
    position: relative;
  }

  .pane {
    position: absolute;
    inset: 0;
    display: none;
    flex-direction: column;
    min-height: 0;
  }

  .pane.is-active {
    display: flex;
  }

  @media (min-width: 769px) {
    .deck {
      margin-inline: var(--sp-5);
    }
  }
</style>
