import { ref } from 'vue'

/**
 * Bulk fold signal for the docked analysis panels.
 *
 * Six expanded panels make for a very long scroll on a phone. Individual
 * chevrons exist on every panel, but folding them one at a time just to get
 * back to the board is busywork — so the sidebar exposes a single control that
 * broadcasts to all of them.
 *
 * A monotonically increasing epoch (rather than a plain shared boolean) lets a
 * panel re-fold itself even when the requested value is unchanged, so the
 * button always does something visible.
 */

const foldEpoch = ref(0)
const foldTarget = ref(false)

/** Ask every docked panel to collapse (true) or expand (false). */
export function foldAllPanels(collapsed: boolean): void {
  foldTarget.value = collapsed
  foldEpoch.value += 1
}

/** Used by DraggablePanel to observe those requests. */
export function usePanelFoldSignal() {
  return { foldEpoch, foldTarget }
}
