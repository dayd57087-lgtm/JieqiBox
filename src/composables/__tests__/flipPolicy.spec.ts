import { describe, expect, it, beforeEach } from 'vitest'
import { ref } from 'vue'
import { setFlipUnattended, useFlipPolicy } from '../useFlipPolicy'
import { useGameSettings } from '../useGameSettings'

/**
 * A league has nobody at the board, and `shouldAsk` has to know it.
 *
 * The rule this guards against is subtle: `useFlipPolicy` already had a
 * "both sides are computers" case, but it returns **true** (ask about
 * everything) because it was written for *watching* two engines — a spectator
 * answers the prompts. A league matches that case exactly, so every face-down
 * move raised the flip dialog and the run stopped until somebody tapped it,
 * which is the opposite of a league.
 *
 * Two things this file has to get right, or it proves nothing:
 *
 * 1. `flipMode` must be `free`, otherwise `shouldAsk` returns false for an
 *    unrelated reason and the unattended case would pass with the bug still in.
 *    (The first version of this test did exactly that and had to be thrown
 *    away — a green test that cannot fail is worse than no test.)
 * 2. Both sides and both prompt kinds are checked, because a league stalls on
 *    whichever one is left out.
 */

const isBoardFlipped = ref(false)

describe('flip policy', () => {
  beforeEach(() => {
    isBoardFlipped.value = false
    setFlipUnattended(false)
    useGameSettings().flipMode.value = 'free'
  })

  it('asks about a moving face-down piece when a human is playing', () => {
    const { shouldAsk } = useFlipPolicy(isBoardFlipped)

    // The baseline the next case is measured against: with a human present and
    // free flip on, a moving face-down piece is always asked about.
    expect(shouldAsk('red', 'move')).toBe(true)
    expect(shouldAsk('black', 'move')).toBe(true)
  })

  it('asks nothing when nobody is at the board', () => {
    setFlipUnattended(true)
    const { shouldAsk } = useFlipPolicy(isBoardFlipped)

    expect(shouldAsk('red', 'move')).toBe(false)
    expect(shouldAsk('black', 'move')).toBe(false)
    expect(shouldAsk('red', 'capture')).toBe(false)
    expect(shouldAsk('black', 'capture')).toBe(false)
  })

  it('goes back to asking once the league stops', () => {
    setFlipUnattended(true)
    expect(useFlipPolicy(isBoardFlipped).shouldAsk('red', 'move')).toBe(false)

    setFlipUnattended(false)
    expect(useFlipPolicy(isBoardFlipped).shouldAsk('red', 'move')).toBe(true)
  })

  it('never asks under random flip, attended or not', () => {
    useGameSettings().flipMode.value = 'random'
    const { shouldAsk } = useFlipPolicy(isBoardFlipped)

    expect(shouldAsk('red', 'move')).toBe(false)

    setFlipUnattended(true)
    expect(shouldAsk('red', 'move')).toBe(false)
  })
})
