import { computed } from 'vue'
import { useGameSettings } from './useGameSettings'
import { useAutoPlay } from './useAutoPlay'

export type Side = 'red' | 'black'

/**
 * Who answers for a face-down piece.
 *
 * In random mode nobody is asked. In free mode a person decides, and when one
 * side is played by the computer that person is the human — but only for *their*
 * side of the board. The computer's own pieces are drawn from the computer's
 * pool, because it has no way to tell us what they were.
 *
 * The two free variants are mirror images:
 *
 * | event                                    | free  | 连线版 |
 * |------------------------------------------|-------|--------|
 * | the human's face-down piece moves        | asks  | drawn  |
 * | the computer's face-down piece moves     | drawn | asks   |
 * | the human captures a face-down piece     | asks  | drawn  |
 * | the computer captures a face-down piece  | drawn | asks   |
 *
 * The capture rows are the ones that matter in practice. A captured piece
 * belongs to the side that did *not* move, so "the computer captured a face-down
 * piece" means a piece of the human's was taken — and in the inverted variant
 * that is exactly the case the operator has to answer for, because it is the one
 * they can read off the platform they are mirroring.
 *
 * ### Which side is the computer?
 *
 * The red/black computer switches, not the human-vs-AI dialog. The dialog is
 * just one way of setting them, and the switches are what actually make the
 * engine move; keying off the dialog alone left this whole policy inert for
 * anyone who simply turned on 红电脑 or 黑电脑 from the toolbar.
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
   * Should the operator be asked about a face-down piece?
   *
   * `actingSide` is the side that made the move — for a capture question too,
   * since the piece being asked about belongs to the other side.
   *
   * When exactly one side is played by the computer the mode decides; the rest
   * of the time the operator answers for everything, which covers two humans at
   * one board, a computer-vs-computer game being supervised, and a position
   * being analysed.
   */
  const shouldAsk = (actingSide: Side): boolean => {
    if (!isFreeFlip.value) return false

    const sides = computerSides.value
    if (sides.length !== 1) return true

    const computerSide = sides[0]
    return flipMode.value === 'free-inverted'
      ? actingSide === computerSide
      : actingSide !== computerSide
  }

  return { shouldAsk, computerSides }
}
