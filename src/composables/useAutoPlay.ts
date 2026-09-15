import { ref } from 'vue'

/**
 * Shared auto-play state.
 *
 * The red/black "computer plays this side" switches used to live as private
 * refs inside AnalysisSidebar, which made them unreachable from the toolbar.
 * They are now module-level singletons so both surfaces read and write the
 * exact same state — no event bus, no duplicated booleans to drift apart.
 *
 * The *actions* stay owned by AnalysisSidebar (it is the component wired to the
 * engine lifecycle) and are registered here on mount, so the toolbar can drive
 * them without re-implementing a single line of the engine logic.
 */

/** Red side is played by the engine. */
const isRedAi = ref(false)

/** Black side is played by the engine. */
const isBlackAi = ref(false)

/** True while a manual (infinite) analysis is running, which blocks auto-play. */
const isManualAnalysis = ref(false)

export interface AutoPlayActions {
  /** Flip the red computer switch, with all its engine side effects. */
  toggleRedAi: () => void
  /** Flip the black computer switch, with all its engine side effects. */
  toggleBlackAi: () => void
  /** Start an infinite analysis, or stop the one that is running. */
  toggleAnalysis: () => void
  /** Force the engine to commit to its current best move right now. */
  moveNow: () => void
}

const actions: Partial<AutoPlayActions> = {}

/** Becomes true once AnalysisSidebar has wired itself up. */
const isControllerReady = ref(false)

/** Called by AnalysisSidebar on mount. Not meant for anyone else. */
export function registerAutoPlayActions(next: Partial<AutoPlayActions>): void {
  Object.assign(actions, next)
  isControllerReady.value = true
}

export function useAutoPlay() {
  return {
    // state
    isRedAi,
    isBlackAi,
    isManualAnalysis,
    isControllerReady,

    // actions — no-ops until the controller registers, so a click before the
    // sidebar mounts can never throw.
    toggleRedAi: () => actions.toggleRedAi?.(),
    toggleBlackAi: () => actions.toggleBlackAi?.(),
    toggleAnalysis: () => actions.toggleAnalysis?.(),
    moveNow: () => actions.moveNow?.(),
  }
}
