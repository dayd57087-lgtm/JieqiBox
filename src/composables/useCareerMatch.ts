import { ref, watch, type Ref } from 'vue'
import {
  type CareerOpponent,
  pickCareerMove,
  sampleThinkTime,
} from './useCareerOpponents'
import {
  applyCareerOverrides,
  restoreCareerOverrides,
  type EngineLike,
  type OptionOverride,
} from './useCareerEngineOptions'
import { useCareer, type MoveRecord, type NewGameRequest } from './useCareer'
import { useConfigManager } from './useConfigManager'
import { useHumanVsAiSettings } from './useHumanVsAiSettings'
import { useAutoPlay } from './useAutoPlay'
import { setBoardRngSeed } from '@/utils/xqf'

/**
 * The lifecycle of one career game.
 *
 * ```
 *  idle → preparing → playing → settling → report → idle
 * ```
 *
 * Two rules this file obeys and nothing else in the app does:
 *
 * 1. **It never re-implements chess.** Every rule, every end condition comes
 *    from `useChessGame`. The career layer only observes the game's own
 *    `isGameEndDialogVisible` / `gameEndResult` and reacts.
 * 2. **It never recomputes rating.** The delta comes back from Rust. The UI
 *    displays it; it does not derive it. Two places computing the same number
 *    is how they end up disagreeing.
 */

export type CareerPhase =
  | 'idle'
  | 'preparing'
  | 'playing'
  | 'settling'
  | 'report'

export interface MatchReport {
  opponentId: string
  result: 'win' | 'loss' | 'draw'
  moves: number
  durationMs: number
  ratingBefore: number
  ratingAfter: number
  ratingDelta: number
  rated: boolean
  /** 1.0 = full credit; lower once this opponent has been farmed today. */
  damping: number
  /** Part of `ratingDelta` earned by clearing this step for the first time. */
  clearBonus: number
  unlocked: string[]
  luckIndex: number | null
  appliedOverrides: OptionOverride[]
  finalFen: string
}

// --------------------------------------------------------------- shared state
//
// Module-level singletons, same pattern as useAutoPlay: the toolbar, the career
// view and the post-game dialog all need to see the same match, and an event
// bus would just give them three chances to disagree.

const phase = ref<CareerPhase>('idle')
/**
 * The opponent of the game in progress, or null.
 *
 * Exported (rather than only reachable through the factory) because the
 * analysis sidebar needs it outside any component that creates a match — it
 * asks "is a career game running, and how deep may this opponent use the book".
 */
export const activeOpponent = ref<CareerOpponent | null>(null)
const lastReport = ref<MatchReport | null>(null)
const moveLog = ref<MoveRecord[]>([])
const log = ref<string[]>([])

/**
 * Open/closed state of the career overlay.
 *
 * It lives here rather than in App.vue because the thing that *opens* it is the
 * drawer item, and the drawer is rendered inside the analysis sidebar. A
 * module-level ref keeps that a one-line change instead of threading an emit
 * through two component layers.
 */
const isCareerViewOpen = ref(false)

/** Read-only view of career mode state for components outside `useCareerMatch`. */
export function useCareerUI() {
  return { isCareerViewOpen, phase, activeOpponent, lastReport }
}

let startedAt = 0
let seed: number | null = null
let appliedOverrides: OptionOverride[] = []
let humanImprovised = false

const pushLog = (line: string) => {
  log.value.push(`${new Date().toLocaleTimeString()} ${line}`)
  if (log.value.length > 200) log.value.shift()
}

// ------------------------------------------------------- engine move picker
//
// The difficulty mechanism lives *here*, not in the engine options: the engine
// is allowed to see the best move, and we deliberately sometimes play a
// different one. `AnalysisSidebar` asks this picker before committing an
// opponent move, so the behaviour is identical whether the move came from a
// search, from ponder, or from the opening book.

type MovePicker = (engineBest: string, candidates: string[]) => string | null

let movePicker: MovePicker | null = null

/** Null when no career game is running — callers must handle that. */
export function getCareerMovePicker(): MovePicker | null {
  return movePicker
}

export function isCareerGameActive(): boolean {
  return phase.value === 'playing' || phase.value === 'preparing'
}

/**
 * Mark the current game as ineligible for rating.
 *
 * Called when the player lets the engine play their own side (`useAutoPlay`),
 * asks for a hint, or takes back a move. This is the difference between a
 * training session and a rated game, and the player should never unknowingly
 * farm their own rating.
 */
export function markCareerGameUnrated(reason: string) {
  if (!isCareerGameActive() || humanImprovised) return
  humanImprovised = true
  pushLog(`unrated: ${reason}`)
}

export function markCareerGameRated() {
  humanImprovised = false
}

/**
 * A move was taken back during a career game.
 *
 * Retracting is not cheating — it is how people study — but the resulting game
 * no longer shows what the player could do unaided, so it stops counting
 * towards the rating. It is still recorded in the history.
 */
export function noteCareerUndo() {
  if (isCareerGameActive()) markCareerGameUnrated('a move was taken back')
}

// ------------------------------------------------------------------- factory

export interface CareerMatchDeps {
  game: any
  engine: EngineLike & {
    isEngineLoaded?: Ref<boolean>
  }
}

export function useCareerMatch({ game, engine }: CareerMatchDeps) {
  const career = useCareer()
  const configManager = useConfigManager()
  const humanVsAi = useHumanVsAiSettings()

  const baselineOptions = (): Record<string, string | number> => {
    const eng = engine.currentEngine?.value
    if (!eng) return {}
    return configManager.getUciOptions(eng.id) ?? {}
  }

  const pushOverrides = () => {
    const opp = activeOpponent.value
    if (!opp) return
    appliedOverrides = applyCareerOverrides(
      engine,
      opp.style,
      baselineOptions()
    )
    pushLog(
      appliedOverrides.length
        ? `opponent options: ${appliedOverrides
            .map(o => `${o.name}=${o.value}`)
            .join(', ')}`
        : 'engine exposes no adjustable options; difficulty limited to think time'
    )
  }

  /**
   * Re-apply the opponent's configuration.
   *
   * Called when an engine (re)appears mid-game: swapping engines from the
   * sidebar drops every option we pushed, and the opponent would silently start
   * playing at the player's own configured strength.
   */
  const applyPendingOverrides = () => {
    if (!activeOpponent.value) return
    if (phase.value !== 'playing' && phase.value !== 'preparing') return
    if (!engine.currentEngine?.value) return
    pushOverrides()
  }

  const startMatch = async (
    opponent: CareerOpponent,
    opts: { humanSide?: 'red' | 'black'; format?: string } = {}
  ): Promise<boolean> => {
    if (phase.value !== 'idle') {
      pushLog('ignored start: a career game is already running')
      return false
    }

    const humanSide = opts.humanSide ?? 'red'
    const opponentSide = humanSide === 'red' ? 'black' : 'red'

    phase.value = 'preparing'
    activeOpponent.value = opponent
    lastReport.value = null
    moveLog.value = []
    log.value = []
    humanImprovised = false
    startedAt = Date.now()
    // Seed the draw sequence from this game's own seed, and record it, so the
    // exact run of face-down draws can be replayed later (M2's luck
    // resampling depends on this).
    seed = (Math.random() * 2 ** 31) | 0
    setBoardRngSeed(seed)

    pushLog(`match vs ${opponent.id} (${opponent.rating}), human=${humanSide}`)

    // An engine is not optional here: the opponent *is* the engine. Refusing
    // up front is much kinder than starting a game the player cannot finish.
    // (Loading is the sidebar's job — it owns the engine list and the picker.)
    if (!engine.currentEngine?.value) {
      pushLog('refused: no engine loaded')
      phase.value = 'idle'
      activeOpponent.value = null
      return false
    }

    // Career games are human-vs-engine by definition; reuse the existing mode
    // rather than inventing a parallel one.
    humanVsAi.setAiSide(opponentSide)
    if (!humanVsAi.isHumanVsAiMode.value) {
      humanVsAi.toggleHumanVsAiMode()
    }

    pushOverrides()

    // A fresh board. Rules, pools and the flip policy all come from here.
    await game.setupNewGame()

    movePicker = (best: string, candidates: string[]) => {
      const opp = activeOpponent.value
      if (!opp) return null
      const choice = pickCareerMove(best, candidates, opp.style)
      if (choice.deliberate) {
        pushLog(`opponent played ${choice.move} over ${best}`)
      }
      return choice.move
    }

    phase.value = 'playing'
    return true
  }

  /**
   * Abandon without recording. Used by "quit to ladder" — an unfinished game
   * must not appear in the history, because a half-played position is not
   * evidence of anything.
   */
  const abandonMatch = () => {
    if (phase.value === 'idle') return
    pushLog('match abandoned, nothing recorded')
    teardown()
    phase.value = 'idle'
  }

  const teardown = () => {
    movePicker = null
    restoreCareerOverrides(engine)
    appliedOverrides = []
    activeOpponent.value = null
    // Leave human-vs-AI mode as the player had it? No — the mode belongs to the
    // career game. Turn it back off so a leftover switch does not make the next
    // casual analysis session play against itself.
    if (humanVsAi.isHumanVsAiMode.value) {
      humanVsAi.toggleHumanVsAiMode()
    }
  }

  /** Collect the per-move records the store wants for M2's analysis. */
  const collectMoveLog = () => {
    const history: any[] = game.history?.value ?? []
    moveLog.value = history
      .filter(h => h.type === 'move')
      .map((h, i) => ({
        ply: i + 1,
        uci: h.data,
        fen: h.fen,
        engineScore: typeof h.engineScore === 'number' ? h.engineScore : null,
        timeMs: typeof h.engineTime === 'number' ? h.engineTime : null,
      }))
  }

  /**
   * Settle the finished game.
   *
   * Called from the watcher below. Deliberately tolerant: if the store write
   * fails (disk full, permission), the player is told and the game is *not*
   * silently swallowed — they can still save the notation by hand.
   */
  const settle = async (
    result: 'win' | 'loss' | 'draw'
  ): Promise<MatchReport | null> => {
    const opp = activeOpponent.value
    if (!opp) return null

    phase.value = 'settling'
    collectMoveLog()

    const durationMs = Math.max(0, Date.now() - startedAt)
    const request: NewGameRequest = {
      opponentId: opp.id,
      opponentRating: opp.rating,
      humanSide: humanVsAi.aiSide.value === 'red' ? 'black' : 'red',
      result,
      moves: moveLog.value.length,
      durationMs,
      format: 'standard',
      rated: !humanImprovised,
      fenSeed: seed,
      initialFen: game.initialFen?.value ?? '',
      finalFen: game.generateFen?.() ?? null,
      luckIndex: null, // wired to the ONNX luck model in M2
      movesDetail: moveLog.value,
    }

    const saved = await career.saveGame(request)

    const report: MatchReport = {
      opponentId: opp.id,
      result,
      moves: request.moves,
      durationMs,
      ratingBefore: saved?.ratingBefore ?? career.profile.value?.rating ?? 0,
      ratingAfter: saved?.ratingAfter ?? career.profile.value?.rating ?? 0,
      ratingDelta: saved?.ratingDelta ?? 0,
      rated: saved?.rated ?? false,
      damping: saved?.damping ?? 1,
      clearBonus: saved?.clearBonus ?? 0,
      unlocked: saved?.unlocked ?? [],
      luckIndex: null,
      appliedOverrides,
      finalFen: request.finalFen ?? '',
    }

    lastReport.value = report
    pushLog(
      saved
        ? `recorded: ${result} in ${request.moves} moves, rating ${report.ratingBefore} → ${report.ratingAfter}` +
            (report.clearBonus > 0
              ? ` (+${report.clearBonus} first clear)`
              : '')
        : 'FAILED to record the game — store unavailable'
    )

    teardown()
    phase.value = 'report'

    // The career report replaces the board's plain win/lose dialog: it carries
    // the result *and* the rating movement, so showing both would be two
    // dialogs for one event. Clearing the flag keeps it from firing later.
    if (game.isGameEndDialogVisible) {
      game.isGameEndDialogVisible.value = false
    }

    return report
  }

  const closeReport = () => {
    lastReport.value = null
    phase.value = 'idle'
  }

  // ------------------------------------------------------------ end-of-game
  //
  // The game module already decides when a game is over; we only react to its
  // dialog flag. Polling would be worse in every way, and duplicating the
  // no-legal-moves check here would eventually disagree with the board.
  const stopWatching = watch(
    () => game.isGameEndDialogVisible?.value,
    async visible => {
      if (!visible) return
      if (phase.value !== 'playing') return

      const raw = game.gameEndResult?.value
      if (raw === 'human_wins') {
        await settle('win')
      } else if (raw === 'ai_wins') {
        await settle('loss')
      } else {
        // The board reports neither `human_wins` nor `ai_wins`, which nothing
        // in the current rules produces. Treat it as a loss rather than
        // inventing a draw — silently crediting a win would be far worse.
        pushLog('end dialog shown without a result; recording as a loss')
        await settle('loss')
      }
    }
  )

  // Apply a pending style as soon as an engine appears.
  if (engine.isEngineLoaded) {
    watch(engine.isEngineLoaded, loaded => {
      if (loaded) applyPendingOverrides()
    })
  }

  /**
   * Anti-farming guard.
   *
   * `useAutoPlay` already lets the engine play either side — it is a legitimate
   * analysis tool, and it is also a one-click way to farm rating. A career game
   * in which the player handed their own side to the engine is still recorded
   * (the game happened, and hiding it would be worse) but it stops moving the
   * rating. See `MIN_RATED_MOVES` in career.rs for the other half of this.
   */
  const autoPlay = useAutoPlay()
  watch([autoPlay.isRedAi, autoPlay.isBlackAi], ([red, black]) => {
    if (!isCareerGameActive()) return
    const humanSide = humanVsAi.aiSide.value === 'red' ? 'black' : 'red'
    if ((humanSide === 'red' && red) || (humanSide === 'black' && black)) {
      markCareerGameUnrated('the engine was playing the player side')
    }
  })

  const sampleOpponentThinkTime = () => {
    const opp = activeOpponent.value
    return opp ? sampleThinkTime(opp.style) : 1000
  }

  return {
    // state
    phase,
    activeOpponent,
    lastReport,
    moveLog,
    log,
    // actions
    startMatch,
    abandonMatch,
    closeReport,
    applyPendingOverrides,
    sampleOpponentThinkTime,
    noteUndo: noteCareerUndo,
    stopWatching,
  }
}
