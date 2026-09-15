import { ref } from 'vue'

/**
 * Board view mode.
 *
 * "Maximised" means the board keeps the whole screen: the hidden-piece strip,
 * the analysis deck and the nav bar step aside. The toolbar stays, because it
 * is how you get back out.
 *
 * Lives in its own module because three different components need to agree on
 * it: App.vue hides the surfaces, the nav bar shows the toggle state.
 */

const isMaximised = ref(false)

export function toggleMaximised(): void {
  isMaximised.value = !isMaximised.value
}

export function useBoardViewState() {
  return { isMaximised, toggleMaximised }
}
