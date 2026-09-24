import { describe, expect, it } from 'vitest'
import { boardRandom, setBoardRngSeed, getBoardRngSeed } from '../xqf'

/**
 * The seed has to actually reach the draws.
 *
 * There used to be two Mersenne Twister instances in this codebase: the one
 * `setBoardRngSeed` seeded (this file's) and a second one inside
 * `useChessGame.ts`, seeded from the clock, which every real draw went through.
 * Seeding therefore changed nothing about a game — a stored seed could not
 * reproduce one, and a league's per-game seed decided nothing — while the
 * comment in `xqf.ts` claimed the opposite.
 *
 * A test is the only thing that would have noticed: both instances were valid
 * Mersenne Twisters, both produced plausible numbers, and nothing in the UI
 * looked wrong. Only "same seed, same sequence" fails when there are two.
 */

const drawTen = (): number[] => {
  const out: number[] = []
  for (let i = 0; i < 10; i++) out.push(boardRandom())
  return out
}

describe('board random source', () => {
  it('replays the same sequence for the same seed', () => {
    setBoardRngSeed(42)
    const first = drawTen()

    setBoardRngSeed(42)
    const second = drawTen()

    expect(second).toEqual(first)
  })

  it('gives different sequences for different seeds', () => {
    setBoardRngSeed(42)
    const a = drawTen()

    setBoardRngSeed(43)
    const b = drawTen()

    expect(b).not.toEqual(a)
  })

  it('keeps producing values in [0, 1)', () => {
    setBoardRngSeed(7)
    for (let i = 0; i < 500; i++) {
      const value = boardRandom()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })

  it('records which seed is driving the sequence', () => {
    setBoardRngSeed(1234)
    expect(getBoardRngSeed()).toBe(1234)

    // No argument means "back to a time-based seed", which is the default for
    // ordinary play; what matters is that a seed is still recorded.
    setBoardRngSeed()
    expect(getBoardRngSeed()).not.toBeNull()
  })

  it('is reproducible across a colour-swapped pair', () => {
    // The two games of a league pair share one seed, so the only difference
    // between them must be which engine held red — that is the entire point of
    // the pairing, and it holds only if the draw sequence is identical.
    setBoardRngSeed(987654)
    const gameOne = drawTen()

    setBoardRngSeed(987654)
    const gameTwo = drawTen()

    expect(gameTwo).toEqual(gameOne)
  })
})
