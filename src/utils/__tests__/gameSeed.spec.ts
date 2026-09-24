import { beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * The board reads its settings through Tauri's `invoke` on construction. There
 * is no Tauri here, and the composables log and carry on with defaults — which
 * works, but buries the test result under three stack traces per run. A quiet
 * test is one whose output somebody will actually read, which is how the first
 * version of this file's comparison bug got noticed at all.
 */
vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (command: string) =>
    command === 'load_config' ? '' : undefined,
  listen: async () => () => undefined,
}))

/**
 * The deal must come from the seeded source.
 *
 * This is the test that would have caught the two-Mersenne-Twister bug: the
 * board kept its own generator seeded from the clock, so `setBoardRngSeed`
 * changed nothing about a game — while `xqf.ts` documented the opposite and
 * career mode stored a seed per game. Both generators were valid and produced
 * plausible numbers; only "start twice from the same seed and get the same
 * deal" fails when there are two of them.
 *
 * What is compared is the mapping from square to identity, not the set of
 * pieces: every game is dealt the same multiset (2 advisors, 2 cannons, … 5
 * pawns aside), so a sorted list of names is identical for every seed and would
 * make this test pass no matter which generator ran. (The first version of this
 * file did exactly that.)
 *
 * The board is a browser-shaped module, so a small stub of the browser surface
 * it touches is installed first — not a DOM: what is under test is where the
 * draws come from, not layout.
 */

const listeners: Record<string, ((event: unknown) => void)[]> = {}

function installBrowserStub() {
  const target = globalThis as unknown as Record<string, unknown>

  target.window = {
    dispatchEvent: (event: { type: string }) => {
      for (const handler of listeners[event.type] ?? []) handler(event)
      return true
    },
    addEventListener: (type: string, handler: (event: unknown) => void) => {
      listeners[type] = listeners[type] ?? []
      listeners[type].push(handler)
    },
    removeEventListener: () => undefined,
    localStorage: {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    },
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  }

  target.CustomEvent = class {
    type: string
    detail: unknown
    constructor(type: string, init?: { detail?: unknown }) {
      this.type = type
      this.detail = init?.detail
    }
  }

  // The board plays a sound as it deals; there is no audio device here.
  target.Audio = class {
    volume = 0
    currentTime = 0
    play = () => Promise.resolve()
    pause = () => undefined
    load = () => undefined
    addEventListener = () => undefined
  }
}

/** Square → identity, so the pairing survives sorting. */
const dealFrom = async (seed: number): Promise<string[]> => {
  const { setBoardRngSeed } = await import('@/utils/xqf')
  const { useChessGame } = await import('@/composables/useChessGame')

  setBoardRngSeed(seed)

  const game = useChessGame()
  game.loadFen(game.initialFen.value, false)

  return game.pieces.value
    .filter((piece: { isKnown: boolean }) => !piece.isKnown)
    .map(
      (piece: { row: number; col: number; name: string }) =>
        `${piece.row}-${piece.col}:${piece.name}`
    )
    .sort()
}

describe('seeded deal', () => {
  beforeAll(() => {
    installBrowserStub()
  })

  it('deals the same squares the same pieces from the same seed', async () => {
    const first = await dealFrom(4242)
    const second = await dealFrom(4242)

    // 30 face-down pieces is the jieqi start position with both kings known.
    expect(first.length).toBe(30)
    expect(second).toEqual(first)
  })

  it('deals them differently from a different seed', async () => {
    const first = await dealFrom(1)
    const second = await dealFrom(2)

    expect(second).not.toEqual(first)
  })
})
