import { computed } from 'vue'
import { useGameSettings } from './useGameSettings'
import { useAutoPlay } from './useAutoPlay'

export type Side = 'red' | 'black'

/** What a face-down piece is being identified for. */
export type FlipPromptKind = 'move' | 'capture'

/**
 * Who answers for a face-down piece.
 *
 * In random mode nobody is asked. In free mode a person decides, and when one
 * side is played by the computer that person is the human — but only for the
 * pieces the human is entitled to name.
 *
 * The two free variants differ in exactly one place: **the capture question**.
 *
 * | event                                     | free  | 连线版 |
 * |-------------------------------------------|-------|--------|
 * | the human's face-down piece moves         | asks  | asks   |
 * | the computer's face-down piece moves      | drawn | drawn  |
 * | the human captures a face-down piece      | asks  | drawn  |
 * | the computer captures a face-down piece   | drawn | asks   |
 *
 * A piece that *moves* is always settled the same way: the human says what
 * their own piece was (they played it), and the computer's is drawn because it
 * cannot be asked. That part is not affected by the variant.
 *
 * A piece that is *captured* belongs to the side that did not move, and that is
 * where the variants part company. Normally the human names the pieces they
 * take; in the mirrored setup the computer's pieces are the ones whose identity
 * comes from the other platform, so the human names those instead, and what they
 * take themselves is simply drawn.
 *
 * ### Which side is the computer?
 *
 * The red/black computer switches, not the human-vs-AI dialog. The dialog is
 * just one way of setting them, and the switches are what actually make the
 * engine move; keying off the dialog alone left this policy inert for anyone who
 * turned on 红电脑 or 黑电脑 from the toolbar.
 */
export function useFlipPolicy() {
  const { flipMode, isFreeFlip } = useGameSettings()
  const { isRedAi, isBlackAi } = useAutoPlay()

  /** Sides the engine plays. Empty, or both, means no single human side. */
  const computerSides = computed<Side[]>(() => {
    const sides: Side[] = []
    if (isRedAi.value) sides.push('red')
    if (isBlackAi.value) sides.push('black')
    return sides
  })

  /**
   * Should the operator name the face-down piece involved in this event?
   *
   * @param actingSide for `move`, the side whose piece moved; for `capture`,
   *   the side that did the capturing (i.e. the piece being asked about belongs
   *   to the other side).
   *
   * With no single computer side — two humans at one board, a computer-vs-
   * computer game being supervised, or a position being analysed — the operator
   * answers for everything, in both variants.
   */
  const shouldAsk = (actingSide: Side, kind: FlipPromptKind): boolean => {
    if (!isFreeFlip.value) return false

    const sides = computerSides.value
    if (sides.length !== 1) return true

    const isHumanActing = actingSide !== sides[0]

    // Only the capture question flips between the two variants.
    return kind === 'capture'
      ? flipMode.value === 'free-inverted'
        ? !isHumanActing
        : isHumanActing
      : isHumanActing
  }

  return { shouldAsk, computerSides }
}
