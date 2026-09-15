<template>
  <nav class="navbar">
    <button
      v-for="btn in BUTTONS"
      :key="btn.id"
      type="button"
      class="navbtn"
      :class="{ 'is-on': isActive(btn.id) }"
      :disabled="btn.needsHistory && historyDisabled"
      :title="$t(btn.labelKey)"
      :aria-label="$t(btn.labelKey)"
      @click="$emit('nav', btn.id)"
    >
      <svg viewBox="0 0 24 24" class="ico" v-html="btn.path" />
    </button>
  </nav>
</template>

<script setup lang="ts">
  /**
   * Bottom navigation bar — a presentational strip.
   *
   * It deliberately owns no game logic: the handlers live with the component
   * that already had them, and this emits which control was pressed. That keeps
   * one implementation of "go to the last move" instead of two that drift.
   */
  import { computed, inject } from 'vue'
  import { useBoardViewState } from '@/composables/useBoardViewState'

  const gameState = inject('game-state') as any
  const { isMaximised } = useBoardViewState()

  const annotationMode = defineModel<boolean>('annotating', { default: false })

  /** Auto-replay is owned by the sidebar; the bar only reflects it. */
  const props = defineProps<{ playing?: boolean }>()

  defineEmits<{ (e: 'nav', id: string): void }>()

  const totalMoves = computed(() => gameState?.history?.value?.length ?? 0)
  const historyDisabled = computed(() => totalMoves.value === 0)

  const isActive = (id: string) => {
    if (id === 'note') return annotationMode.value
    if (id === 'maximise') return isMaximised.value
    if (id === 'play') return !!props.playing
    return false
  }

  const BUTTONS = [
    {
      id: 'first',
      labelKey: 'navbar.first',
      needsHistory: true,
      path: '<path d="M11 6l-6 6 6 6M19 6l-6 6 6 6" stroke-linecap="round" stroke-linejoin="round"/>',
    },
    {
      id: 'prev',
      labelKey: 'navbar.prev',
      needsHistory: true,
      path: '<path d="M15 5l-7 7 7 7" stroke-linecap="round" stroke-linejoin="round"/>',
    },
    {
      id: 'next',
      labelKey: 'navbar.next',
      needsHistory: true,
      path: '<path d="M9 5l7 7-7 7" stroke-linecap="round" stroke-linejoin="round"/>',
    },
    {
      id: 'last',
      labelKey: 'navbar.last',
      needsHistory: true,
      path: '<path d="M13 6l6 6-6 6M5 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round"/>',
    },
    {
      id: 'undo',
      labelKey: 'navbar.undo',
      needsHistory: true,
      path: '<path d="M3 12a9 9 0 1 0 3-6.7" stroke-linecap="round"/><path d="M3 4v5h5" stroke-linejoin="round"/>',
    },
    {
      id: 'play',
      labelKey: 'navbar.play',
      needsHistory: true,
      path: '<path d="M7 4.5l12 7.5-12 7.5z" fill="currentColor" stroke-linejoin="round"/>',
    },
    {
      id: 'note',
      labelKey: 'navbar.note',
      needsHistory: false,
      path: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z" stroke-linejoin="round"/>',
    },
    {
      id: 'maximise',
      labelKey: 'navbar.maximise',
      needsHistory: false,
      path: '<path d="M4 9V4h5M20 15v5h-5M20 9V4h-5M4 15v5h5" stroke-linecap="round" stroke-linejoin="round"/>',
    },
  ]
</script>

<style scoped lang="scss">
  .navbar {
    flex: 0 0 auto;
    height: 48px;
    display: flex;
    align-items: center;
    justify-content: space-around;
    padding: 0 var(--sp-2) env(safe-area-inset-bottom);
    background: rgb(var(--c-surface));
    border-top: 1px solid rgb(var(--c-divider));
  }

  .navbtn {
    flex: 1 1 0;
    height: 44px;
    display: grid;
    place-items: center;
    border: none;
    border-radius: var(--r-sm);
    background: transparent;
    color: rgb(var(--c-text));
    cursor: pointer;
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  .navbtn:disabled {
    opacity: 0.3;
  }

  .navbtn:not(:disabled):active {
    background: rgb(var(--c-surface-3));
  }

  .navbtn.is-on {
    background: rgb(var(--c-primary-soft));
    color: rgb(var(--c-primary-text));
  }

  .ico {
    width: 20px;
    height: 20px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.7;
  }

  @media (min-width: 769px) {
    .navbar {
      padding-inline: var(--sp-5);
    }
  }
</style>
