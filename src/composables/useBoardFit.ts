import { ref } from 'vue'

/**
 * A one-line contract for "the layout below the board just changed, please
 * re-measure it".
 *
 * The board is a fixed 9:10 rectangle inside a flex column, so its size has to
 * be computed from the space left over. A ResizeObserver on the board's own box
 * covers most cases, but it is not sufficient on its own: browser notifications
 * are delivered during the rendering steps, which are *skipped while the
 * document is hidden*, so a resize that happens in a background tab is simply
 * never reported.
 *
 * Rather than depend on that, the components that actually change the layout
 * (the deck being dragged, the piece strip being folded) say so explicitly.
 * The board then re-measures on the next frame, deterministically.
 */

const fitFn = ref<(() => void) | null>(null)

/** Called once by the component that owns the board's container. */
export function registerBoardFit(fn: () => void): void {
  fitFn.value = fn
}

/** Called by anything that changes how much room the board has. */
export function requestBoardFit(): void {
  const fn = fitFn.value
  if (!fn) return

  // Measure immediately. Reading a layout property forces a reflow, so this
  // already sees the new sizes — and unlike an animation frame, it still runs
  // when the document is hidden, which is exactly when notifications stop.
  fn()

  // Then once more on the next frame, for the case where the change was made
  // this tick and has not been laid out yet.
  requestAnimationFrame(fn)
}
