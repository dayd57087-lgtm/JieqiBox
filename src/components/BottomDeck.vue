<template>
  <section class="deck">
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
  </section>
</template>

<script setup lang="ts">
  /**
   * Bottom deck — 分析 / 开局库 / 导航.
   *
   * A pure shell: it owns which tab is showing and nothing else. The panes are
   * slots so each keeps living in the component that owns its logic, rather
   * than being torn apart just to be re-parented here.
   */
  import { ref, watch } from 'vue'

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

  const DECK_KEY = 'jieqi.deck'

  const readStored = () => {
    try {
      const raw = localStorage.getItem(DECK_KEY)
      if (!raw) return null
      return JSON.parse(raw) as { tab?: DeckTab; density?: DeckDensity }
    } catch {
      return null
    }
  }

  const stored = readStored()

  const active = ref<DeckTab>(stored?.tab ?? 'analysis')
  const density = ref<DeckDensity>(stored?.density ?? 'standard')

  const persist = () => {
    try {
      localStorage.setItem(
        DECK_KEY,
        JSON.stringify({ tab: active.value, density: density.value })
      )
    } catch {
      // Not worth surfacing: the deck still works, it just forgets.
    }
  }

  const select = (id: DeckTab) => {
    active.value = id
    persist()
  }

  // Density drives the row height of whatever the panes render, so it is
  // published as a data attribute on <body> rather than threaded through as a
  // prop to every pane.
  watch(
    density,
    () => {
      document.body.dataset.deckDensity = density.value
      persist()
    },
    { immediate: true }
  )

  defineExpose({ select })
</script>

<style scoped lang="scss">
  .deck {
    flex: 0 1 auto;
    height: 206px;
    min-height: 168px;
    margin: 0 var(--sp-2) var(--sp-2);
    display: flex;
    flex-direction: column;
    border: 1px solid rgb(var(--c-border));
    border-radius: var(--r-md);
    background: rgb(var(--c-surface));
    box-shadow: var(--sh-1);
    overflow: hidden;
  }

  .deck__tabs {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    padding: 2px var(--sp-2) 2px var(--sp-3);
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
      height: 240px;
    }
  }
</style>
