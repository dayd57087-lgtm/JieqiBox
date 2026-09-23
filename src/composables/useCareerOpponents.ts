/**
 * The career ladder: who you play, and *how* they play.
 *
 * The single most important decision in this file is that difficulty is NOT
 * expressed as "engine strength". Jieqi hides half the pieces from both sides,
 * so a weakened engine does not look weak — it looks broken, because it walks
 * into losses it could obviously see. Players read that as a bug, not a
 * challenge.
 *
 * So an opponent is a *style*, built from four knobs that degrade gracefully:
 *
 *   1. `bookPlies`    how long they can lean on the opening book
 *   2. `candidateWidth` how many moves they even consider (MultiPV)
 *   3. `pickTopProbability` how often they take the best candidate — the rest
 *      of the time they pick among the others. This is the main dial: they
 *      still play *legal, plausible* moves, just not always the best one.
 *   4. `thinkTimeMs`  a randomised window, so they don't feel like a metronome
 *
 * `UCI_Elo` / `Skill Level` are only a last-resort fallback for engines that
 * implement them. They are not the primary mechanism, deliberately.
 *
 * Opponent names and bios live in the i18n bundles (`career.opponents.<id>`),
 * not here — this file stays free of user-visible strings.
 */

export interface CareerOpponentStyle {
  /** MultiPV width: how many candidate moves the opponent is allowed to see. */
  candidateWidth: number
  /** Probability of playing the engine's top choice. Otherwise a uniformly
   *  random pick among the remaining candidates. */
  pickTopProbability: number
  /** Think-time window in ms, sampled per move. */
  thinkTimeMs: [number, number]
  /** How deep into the opening book the opponent is willing to stay. */
  bookPlies: number
  /** Win probability bias for captures/checks, 0 = neutral. Reserved: applied
   *  once the candidate scorer lands in M2. */
  aggression?: number
  /** Only used when the engine advertises UCI_LimitStrength / UCI_Elo. */
  elo?: number
  /** Only used when the engine advertises a `Skill Level` option. */
  skill?: number
}

export interface CareerOpponent {
  id: string
  /** Shown as the ladder position; also the sort order. */
  tier: number
  rating: number
  /** Style pack used to configure the engine for this match. */
  style: CareerOpponentStyle
  /** Achievements the player must already hold before this card is playable.
   *  Empty for the whole first block. */
  requires?: string[]
  /** Rating the player must have reached, if the card is gated on progress
   *  rather than on beating the previous step. */
  minRating?: number
  /** Cosmetic: draw the card with a "boss" treatment. */
  boss?: boolean
}

/**
 * Twelve steps from "just learned the rules" to the endgame.
 *
 * The rating numbers are the *anchor* the career rating system compares
 * against, so they matter: they should be roughly "what a human of this level
 * plays like", not "what the engine would score at". See CAREER_MODE_DESIGN.md
 * §6.8 for how to re-calibrate them with a real match run.
 */
export const CAREER_OPPONENTS: CareerOpponent[] = [
  {
    id: 'child_beginner',
    tier: 1,
    rating: 800,
    style: {
      candidateWidth: 2,
      pickTopProbability: 0.55,
      thinkTimeMs: [200, 700],
      bookPlies: 4,
      elo: 800,
      skill: 0,
    },
  },
  {
    id: 'neighbour_kid',
    tier: 2,
    rating: 950,
    style: {
      candidateWidth: 2,
      pickTopProbability: 0.62,
      thinkTimeMs: [200, 800],
      bookPlies: 4,
      aggression: 0.6,
      elo: 1000,
      skill: 2,
    },
  },
  {
    id: 'park_regular',
    tier: 3,
    rating: 1100,
    style: {
      candidateWidth: 3,
      pickTopProbability: 0.68,
      thinkTimeMs: [400, 1400],
      bookPlies: 6,
      elo: 1200,
      skill: 4,
    },
  },
  {
    id: 'reva',
    tier: 4,
    rating: 1250,
    style: {
      candidateWidth: 3,
      pickTopProbability: 0.74,
      thinkTimeMs: [300, 1200],
      bookPlies: 8,
      aggression: 0.3,
      elo: 1300,
      skill: 6,
    },
  },
  {
    id: 'street_stall_boss',
    tier: 5,
    rating: 1400,
    style: {
      candidateWidth: 3,
      pickTopProbability: 0.8,
      thinkTimeMs: [600, 2000],
      bookPlies: 14,
      elo: 1450,
      skill: 8,
    },
  },
  {
    id: 'online_blitz_king',
    tier: 6,
    rating: 1550,
    style: {
      candidateWidth: 4,
      pickTopProbability: 0.84,
      thinkTimeMs: [150, 600],
      bookPlies: 10,
      elo: 1600,
      skill: 10,
    },
  },
  {
    id: 'city_quarter_final',
    tier: 7,
    rating: 1700,
    style: {
      candidateWidth: 4,
      pickTopProbability: 0.88,
      thinkTimeMs: [500, 1800],
      bookPlies: 16,
      elo: 1750,
      skill: 12,
    },
  },
  {
    id: 'city_champion',
    tier: 8,
    rating: 1850,
    style: {
      candidateWidth: 4,
      pickTopProbability: 0.92,
      thinkTimeMs: [600, 2200],
      bookPlies: 20,
      elo: 1900,
      skill: 14,
    },
  },
  {
    id: 'province_sparring',
    tier: 9,
    rating: 2000,
    style: {
      candidateWidth: 5,
      pickTopProbability: 0.95,
      thinkTimeMs: [800, 2600],
      bookPlies: 24,
      elo: 2050,
      skill: 17,
    },
  },
  {
    id: 'professional',
    tier: 10,
    rating: 2150,
    style: {
      candidateWidth: 5,
      pickTopProbability: 0.97,
      thinkTimeMs: [1000, 3000],
      bookPlies: 30,
      elo: 2200,
      skill: 20,
    },
  },
  {
    id: 'grandmaster',
    tier: 11,
    rating: 2350,
    style: {
      candidateWidth: 6,
      pickTopProbability: 0.99,
      thinkTimeMs: [1200, 3600],
      bookPlies: 40,
      elo: 2400,
      skill: 24,
    },
  },
  {
    id: 'jieqi_god',
    tier: 12,
    rating: 2600,
    boss: true,
    style: {
      candidateWidth: 8,
      pickTopProbability: 1.0,
      thinkTimeMs: [1500, 4000],
      bookPlies: 999,
      elo: 2600,
    },
  },
]

export function opponentById(id: string): CareerOpponent | undefined {
  return CAREER_OPPONENTS.find(o => o.id === id)
}

/**
 * How the ladder opens up.
 *
 * Beat a step and the next one lights up. We also allow a *rating* bypass so a
 * genuinely strong player is not forced through twelve games against children
 * before the app takes them seriously — but beating a step always works too.
 */
export function isOpponentUnlocked(
  opponent: CareerOpponent,
  clearedTier: number,
  rating: number
): boolean {
  if (opponent.tier === 1) return true
  if (opponent.rating <= rating + 150) return true
  return clearedTier >= opponent.tier - 1
}

/** Highest tier the player has beaten, from the store's per-opponent records. */
export function clearedTierFromProgress(
  progress: Array<{ opponentId: string; wins: number }>
): number {
  let best = 0
  for (const p of progress) {
    if (p.wins <= 0) continue
    const opp = opponentById(p.opponentId)
    if (opp && opp.tier > best) best = opp.tier
  }
  return best
}

/** Sample a think time inside the opponent's window. */
export function sampleThinkTime(style: CareerOpponentStyle): number {
  const [lo, hi] = style.thinkTimeMs
  return Math.round(lo + Math.random() * Math.max(0, hi - lo))
}

/**
 * Choose which candidate the opponent actually plays.
 *
 * `engineBest` is what the engine returned; `candidates` is the MultiPV list it
 * reported. With probability `pickTopProbability` we honour the engine, else we
 * pick one of the others. Returns the original move when there is nothing to
 * choose between — a losing position often has only one legal move, and the
 * opponent should not be punished for that.
 */
export function pickCareerMove(
  engineBest: string,
  candidates: string[],
  style: CareerOpponentStyle
): { move: string; deliberate: boolean } {
  const pool = candidates.filter(m => m && m !== engineBest)
  if (pool.length === 0 || Math.random() < style.pickTopProbability) {
    return { move: engineBest, deliberate: false }
  }
  const alt = pool[Math.floor(Math.random() * pool.length)]
  return { move: alt, deliberate: true }
}
