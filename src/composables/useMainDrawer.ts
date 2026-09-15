import { ref } from 'vue'

/**
 * Left drawer — open state plus an action registry.
 *
 * The drawer holds every function the main screen no longer shows, and those
 * functions are owned by two different components: TopToolbar owns the game
 * file and interface actions, AnalysisSidebar owns the engine and analysis
 * ones. Neither can host the drawer without the other's items going missing.
 *
 * So the drawer is hosted by App.vue and the owners *register* their handlers
 * here. Same pattern as useAutoPlay: state and behaviour in one place, no
 * duplicated booleans drifting apart.
 */

const isOpen = ref(false)

export function openDrawer(): void {
  isOpen.value = true
}

export function closeDrawer(): void {
  isOpen.value = false
}

export function toggleDrawer(): void {
  isOpen.value = !isOpen.value
}

export function useDrawerState() {
  return { isOpen }
}

/* ------------------------------------------------------------------ */

type ActionResult = void | Promise<void>
type ActionMap = Record<string, () => ActionResult>

const actions: ActionMap = {}

/** Called by components that own drawer actions. Later registrations win. */
export function registerDrawerActions(map: ActionMap): void {
  Object.assign(actions, map)
}

/**
 * Wrap a statement that returns a value (an assignment, a toggle) so it can be
 * registered as an action. Keeping the wrapper explicit beats loosening the
 * ActionMap type, which would let genuinely wrong handlers slip through.
 */
export function asAction(fn: () => unknown): () => void {
  return () => {
    fn()
  }
}

/** Called by the drawer when an item is activated. */
export function runDrawerAction(id: string): void {
  const fn = actions[id]
  if (!fn) {
    // A missing handler means an item was added without an owner. Failing
    // loudly in dev beats a button that silently does nothing.
    if (import.meta.env.DEV) console.warn(`[drawer] no handler for "${id}"`)
    return
  }
  void fn()
}
