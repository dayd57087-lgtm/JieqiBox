import type { CareerOpponentStyle } from './useCareerOpponents'
import { sampleThinkTime } from './useCareerOpponents'

/**
 * Match-scoped UCI option overrides.
 *
 * ## Why this exists
 *
 * `UciOptionsDialog` writes options into the config file, per engine. That is
 * the right model for "how do I like my engine configured" — and completely
 * wrong for a career ladder, where the *next* opponent needs a different
 * engine setup while the player's preferences must survive untouched.
 *
 * Without this layer, playing 学棋童子 would silently rewrite the settings the
 * player uses for analysis, and the damage would only surface later as "my
 * engine feels weird now".
 *
 * So: snapshot what the engine has, push the opponent's overrides, play, then
 * restore the snapshot. The snapshot is taken from the *config file*, which is
 * the player's own preference, and restoration re-sends those values.
 *
 * Overrides are intentionally not written to the config file. Nothing here
 * touches `saveConfig()`.
 */

export interface OptionOverride {
  name: string
  value: string | number
}

/** One of the engine's advertised options, parsed from its `uci` output. */
interface AdvertisedOption {
  name: string
  type: string
  min?: number
  max?: number
}

/**
 * Parse the option list out of the raw UCI handshake text.
 *
 * We need this rather than blind-sending `setoption` because engines differ
 * wildly: some have `Skill Level`, some have `UCI_Elo`, Pikafish has neither,
 * and sending an unknown option is at best ignored and at worst fatal on some
 * strict engines.
 */
export function parseAdvertisedOptions(raw: string): AdvertisedOption[] {
  const out: AdvertisedOption[] = []
  const re = /^option name (.+?) type (\S+)(.*)$/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(raw)) !== null) {
    const [, name, type, rest] = m
    const minMatch = /min\s+(-?\d+)/.exec(rest)
    const maxMatch = /max\s+(-?\d+)/.exec(rest)
    out.push({
      name: name.trim(),
      type,
      min: minMatch ? parseInt(minMatch[1], 10) : undefined,
      max: maxMatch ? parseInt(maxMatch[1], 10) : undefined,
    })
  }
  return out
}

function clamp(v: number, min?: number, max?: number): number {
  if (min !== undefined && v < min) return min
  if (max !== undefined && v > max) return max
  return v
}

/**
 * Turn an opponent's style into concrete `setoption` commands.
 *
 * The order matters: strength-limiting options are applied *first* so that if
 * the engine rejects one, the candidate-width setting still lands.
 */
export function buildOpponentOverrides(
  style: CareerOpponentStyle,
  advertised: AdvertisedOption[]
): OptionOverride[] {
  const overrides: OptionOverride[] = []
  const byName = new Map(advertised.map(o => [o.name.toLowerCase(), o]))

  // 1. Strength limiting, only if the engine actually offers it.
  const eloOpt = byName.get('uci_elo')
  const limitOpt = byName.get('uci_limitstrength')
  if (style.elo !== undefined && eloOpt) {
    overrides.push({
      name: 'UCI_Elo',
      value: clamp(style.elo, eloOpt.min, eloOpt.max),
    })
    if (limitOpt) {
      overrides.push({ name: 'UCI_LimitStrength', value: 'true' })
    }
  }

  const skillOpt = byName.get('skill level')
  if (style.skill !== undefined && skillOpt) {
    overrides.push({
      name: 'Skill Level',
      value: clamp(style.skill, skillOpt.min, skillOpt.max),
    })
  }

  // 2. Candidate width. This is the one that matters most for jieqi: a narrow
  //    MultiPV forces the opponent to choose between plausible moves, which
  //    reads as "human" rather than "broken".
  if (style.candidateWidth > 1 && byName.has('multipv')) {
    const mpv = byName.get('multipv')!
    overrides.push({
      name: 'MultiPV',
      value: clamp(style.candidateWidth, mpv.min, mpv.max),
    })
  }

  return overrides
}

/**
 * Live session state, so a crash or a hot-reload cannot leave the engine
 * configured for an opponent that is no longer being played.
 */
interface AppliedOverrides {
  engineId: string
  /** The player's own configured values, keyed by option name. */
  baseline: Record<string, string | number>
  /** Names we pushed, so restoration knows exactly what to put back. */
  applied: string[]
}

let session: AppliedOverrides | null = null

export interface EngineLike {
  send: (cmd: string) => void
  currentEngine: { value: { id: string; name: string } | null }
  uciOptionsText?: { value: string }
}

/**
 * Push the opponent's configuration onto the engine.
 *
 * Returns the overrides that were actually applied so the caller can log or
 * report them — a player who wonders why the opponent felt slow deserves an
 * answer in the match preview.
 */
export function applyCareerOverrides(
  engine: EngineLike,
  style: CareerOpponentStyle,
  baseline: Record<string, string | number>
): OptionOverride[] {
  const eng = engine.currentEngine?.value
  if (!eng) return []

  // A stale session from a previous match would restore the wrong values.
  if (session && session.engineId !== eng.id) {
    session = null
  }

  const advertised = parseAdvertisedOptions(engine.uciOptionsText?.value ?? '')
  if (advertised.length === 0) {
    console.warn(
      '[career] engine advertised no UCI options; opponent style cannot be applied'
    )
    return []
  }

  const overrides = buildOpponentOverrides(style, advertised)

  for (const o of overrides) {
    engine.send(`setoption name ${o.name} value ${o.value}`)
  }

  session = {
    engineId: eng.id,
    baseline: { ...baseline },
    applied: overrides.map(o => o.name),
  }

  return overrides
}

/**
 * Put the player's own settings back.
 *
 * Only the options we touched are restored. Everything else was never changed,
 * and re-sending it would be both pointless and a source of surprise if the
 * player altered a setting mid-game from the UCI options dialog.
 */
export function restoreCareerOverrides(engine: EngineLike): void {
  if (!session) return
  const eng = engine.currentEngine?.value
  if (!eng || eng.id !== session.engineId) {
    session = null
    return
  }

  for (const name of session.applied) {
    const original = session.baseline[name]
    if (original === undefined) continue
    if (original === '__button__') continue // button-type sentinel, not a value
    engine.send(`setoption name ${name} value ${original}`)
  }

  session = null
}

export function hasActiveCareerOverrides(): boolean {
  return session !== null
}

/** Search limits for the opponent's move: their own think time, not the
 *  player's analysis settings. */
export function careerSearchLimits(style: CareerOpponentStyle): {
  movetime: number
} {
  return { movetime: sampleThinkTime(style) }
}
