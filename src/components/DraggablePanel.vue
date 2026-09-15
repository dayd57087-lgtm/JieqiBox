<template>
  <div ref="dockingTarget" class="docking-target">
    <template v-if="isDocked">
      <section
        class="panel-content section"
        :class="{ 'is-collapsed': isCollapsed }"
      >
        <header class="panel-header">
          <div class="panel-header__title" @click="toggleCollapsed">
            <slot name="header"></slot>
          </div>

          <button
            type="button"
            class="panel-header__btn"
            :aria-expanded="!isCollapsed"
            :title="
              isCollapsed
                ? $t('analysis.expandPanel')
                : $t('analysis.collapsePanel')
            "
            @click="toggleCollapsed"
          >
            <i
              class="mdi"
              :class="isCollapsed ? 'mdi-chevron-down' : 'mdi-chevron-up'"
            ></i>
          </button>

          <!-- Dragging a panel is a desktop gesture; hide it on phones. -->
          <button
            type="button"
            class="panel-header__btn panel-header__btn--undock"
            :title="$t('analysis.undockPanel')"
            @click="handleUndock"
          >
            <i class="mdi mdi-arrow-expand"></i>
          </button>
        </header>

        <div v-show="!isCollapsed" class="panel-body">
          <slot></slot>
        </div>
      </section>
    </template>
  </div>

  <!-- Teleport the draggable component to body when undocked -->
  <Teleport to="body" v-if="!isDocked">
    <Vue3DraggableResizable
      :initW="panelState.width.value"
      :initH="panelState.height.value"
      v-model:x="panelState.x.value"
      v-model:y="panelState.y.value"
      v-model:w="panelState.width.value"
      v-model:h="panelState.height.value"
      :active="isActive"
      @update:active="isActive = $event"
      :draggable="true"
      :resizable="true"
      :parent="false"
      @drag-end="onDragEnd"
      classNameHandle="drag-handle"
      class="undocked-panel"
    >
      <div class="undocked-panel-wrapper">
        <header class="panel-header drag-handle">
          <div class="panel-header__title">
            <slot name="header"></slot>
          </div>
          <button
            type="button"
            class="panel-header__btn"
            :title="$t('analysis.dockPanel')"
            @click="handleDock"
          >
            <i class="mdi mdi-dock-window"></i>
          </button>
        </header>
        <div class="undocked-panel-content">
          <slot></slot>
        </div>
      </div>
    </Vue3DraggableResizable>
  </Teleport>
</template>

<script setup lang="ts">
  import { ref, watch, computed } from 'vue'
  import Vue3DraggableResizable from 'vue3-draggable-resizable'
  import 'vue3-draggable-resizable/dist/Vue3DraggableResizable.css'
  import { usePanelManager } from '@/composables/usePanelManager'
  import { usePanelFoldSignal } from '@/composables/usePanelFold'

  const props = defineProps({
    panelId: {
      type: String,
      required: true,
    },
  })

  const { getPanelState, updatePanelState, dockPanel, undockPanel } =
    usePanelManager()

  const panelRefs = getPanelState(props.panelId)
  if (!panelRefs) {
    throw new Error(`Panel with id ${props.panelId} not found`)
  }
  const panelState = panelRefs

  const isDocked = computed(() => panelState.isDocked.value)

  const dockingTarget = ref<HTMLElement | null>(null)
  const isActive = ref(false)

  /* ---------- Collapse ----------
   * On a phone the sidebar is six stacked panels; letting the user fold the
   * ones they are not watching is the difference between "scroll forever" and
   * "the board stays reachable". State persists per panel.
   *
   * First run on a phone starts folded — the panels are deep information, and
   * the toolbar already covers the everyday actions. Desktop keeps them open,
   * because there the sidebar is a rail beside the board, not a scroll below
   * it.
   */
  const COLLAPSE_KEY = `jieqi.panel.collapsed.${props.panelId}`

  const isCollapsed = ref(false)
  try {
    const stored = localStorage.getItem(COLLAPSE_KEY)
    isCollapsed.value =
      stored === null
        ? window.matchMedia('(max-width: 768px)').matches
        : stored === '1'
  } catch {
    // Storage unavailable (private mode) — fall back to expanded.
  }

  const toggleCollapsed = () => {
    isCollapsed.value = !isCollapsed.value
    persistCollapsed()
  }

  const persistCollapsed = () => {
    try {
      localStorage.setItem(COLLAPSE_KEY, isCollapsed.value ? '1' : '0')
    } catch {
      // Not worth surfacing: the panel still works, it just forgets.
    }
  }

  // Obey the sidebar's "collapse all / expand all" control.
  const { foldEpoch, foldTarget } = usePanelFoldSignal()
  watch(foldEpoch, () => {
    isCollapsed.value = foldTarget.value
    persistCollapsed()
  })

  const handleUndock = () => {
    if (dockingTarget.value) {
      const rect = dockingTarget.value.getBoundingClientRect()
      undockPanel(props.panelId, {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height < 100 ? 200 : rect.height, // Set a min height on undock
      })
    }
  }

  const handleDock = () => {
    dockPanel(props.panelId)
  }

  const onDragEnd = (payload: { x: number; y: number }) => {
    const sidebar = document.querySelector('.sidebar')
    if (sidebar) {
      const sidebarRect = sidebar.getBoundingClientRect()
      const proximity = 60

      if (
        payload.x + panelState.width.value > sidebarRect.left - proximity &&
        payload.x < sidebarRect.right + proximity &&
        payload.y + panelState.height.value > sidebarRect.top - proximity &&
        payload.y < sidebarRect.bottom + proximity
      ) {
        handleDock()
      }
    }
  }

  watch(
    () => [
      panelState.x.value,
      panelState.y.value,
      panelState.width.value,
      panelState.height.value,
    ],
    ([x, y, width, height]) => {
      updatePanelState(props.panelId, { x, y, width, height })
    }
  )
</script>

<style>
  .undocked-panel {
    z-index: 1000;
  }

  .docking-target {
    width: 100%;
  }

  /* ---------- Docked panel = a card ---------- */
  .docking-target .panel-content {
    padding: var(--sp-3);
    border: 1px solid rgb(var(--c-border));
    border-radius: var(--r-md);
    background: rgb(var(--c-surface));
    box-shadow: var(--sh-1);
  }

  .panel-header {
    display: flex;
    align-items: center;
    gap: var(--sp-1);
    margin-bottom: var(--sp-2);
    padding-bottom: var(--sp-2);
    border-bottom: 1px solid rgb(var(--c-divider));
  }

  .panel-header__title {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    cursor: pointer;
    -webkit-user-select: none;
    user-select: none;
  }

  /* Folded panels keep their header as a tap target and drop the rule. */
  .panel-content.is-collapsed .panel-header {
    margin-bottom: 0;
    padding-bottom: 0;
    border-bottom: none;
  }

  .panel-header__btn {
    flex: 0 0 auto;
    width: 28px;
    height: 28px;
    display: grid;
    place-items: center;
    padding: 0;
    border: none;
    border-radius: var(--r-xs);
    background: transparent;
    color: rgb(var(--c-text-3));
    font-size: 18px;
    cursor: pointer;
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  .panel-header__btn:hover {
    background: rgb(var(--c-surface-3));
    color: rgb(var(--c-text));
  }

  .panel-header__btn:active {
    background: rgb(var(--c-border));
  }

  .panel-body {
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
  }

  /* ---------- Undocked panel ---------- */
  .undocked-panel-wrapper {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    overflow: hidden;
    border: 1px solid rgb(var(--c-border));
    border-radius: var(--r-md);
    background-color: rgb(var(--c-surface));
    box-shadow: var(--sh-3);
  }

  .undocked-panel-wrapper .panel-header {
    margin: 0;
    padding: var(--sp-2) var(--sp-3);
    border-bottom: 1px solid rgb(var(--c-divider));
    cursor: move;
  }

  .panel-header h3 {
    margin: 0;
    padding: 0;
    font-size: var(--fs-sm);
    font-weight: var(--fw-semibold);
    flex-grow: 1;
  }

  .undocked-panel-content {
    flex-grow: 1;
    overflow: auto;
    height: calc(100% - 40px);
    padding: var(--sp-2) var(--sp-3);
  }

  /* Panel titles are quiet labels, not headings. */
  .panel-header .section-title,
  .panel-header h3 {
    margin: 0;
    font-size: var(--fs-sm);
    font-weight: var(--fw-semibold);
    letter-spacing: 0.02em;
    color: rgb(var(--c-text-2));
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* ---------- Mobile ---------- */
  @media (max-width: 768px) {
    .panel-header__btn {
      width: var(--tap-min);
      height: var(--tap-min);
      margin-right: calc(var(--sp-2) * -1);
    }

    /* Undocking by dragging is meaningless on a phone. */
    .docking-target .panel-header__btn--undock {
      display: none;
    }

    .docking-target .panel-content {
      padding: var(--sp-3);
    }
  }
</style>
