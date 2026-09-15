import { computed } from 'vue'
import { useGameSettings } from './useGameSettings'
import { useHumanVsAiSettings } from './useHumanVsAiSettings'

export type Side = 'red' | 'black'

/**
 * Who answers for a face-down piece.
 *
 * In random mode nobody is asked. In free mode a person decides, and in a
 * human-vs-computer game that person is the human — but only for *their* side
 * of the board. The computer's pieces are drawn from the computer's pool.
 *
 * The two free variants are mirror images:
 *
 * | event                                   | free | free-inverted |
 * |-----------------------------------------|------|---------------|
 * | the human's face-down piece moves       | asks | drawn         |
 * | the computer's face-down piece moves    | drawn| asks          |
 * | the human captures a face-down piece    | asks | drawn         |
 * | the computer captures a face-down piece | drawn| asks          |
 *
 * The second half of that table is the part that matters in practice: the
 * captured piece belongs to the side that did *not* move, so "the computer
 * captured a face-down piece" means "a piece belonging to the human was taken"
 * — and in the inverted variant that is exactly the case the user has to answer
 * for, because they can read it off the platform they are mirroring.
 *
 * When there is no computer in the game (both sides played by a person, or a
 * position being analysed) there is nobody to draw for, so the operator answers
 * for everything.
 */
export function useFlipPolicy() {
  const { flipMode, isFreeFlip } = useGameSettings()
  const { isHumanVsAiMode, aiSide } = useHumanVsAiSettings()

  const humanSide = computed<Side>(() =>
    aiSide.value === 'red' ? 'black' : 'red'
  )

  /**
   * Should the operator be asked about a face-down piece belonging to the side
   * that just acted? `actingSide` is the side that made the move — for a
   * capture question too, since the captured piece belongs to the other side.
   */
  const shouldAsk = (actingSide: Side): boolean => {
    if (!isFreeFlip.value) return false
    if (!isHumanVsAiMode.value) return true
    const actedIsHuman = actingSide === humanSide.value
    return flipMode.value === 'free-inverted' ? !actedIsHuman : actedIsHuman
  }

  return { shouldAsk, humanSide }
}
