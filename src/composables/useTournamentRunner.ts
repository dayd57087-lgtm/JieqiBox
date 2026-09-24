import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { setBoardRngSeed } from '@/utils/xqf'
import { useTournament } from './useTournament'
import type {
  GameEndReason,
  GamePlan,
  GameResultInput,
  TournamentEntry,
} from '@/types/tournament'

/**
 * The league runner: it plays the games, Rust keeps the score.
 *
 * Three rules this file obeys, and they are the reason it can be trusted with
 * an overnight run:
 *
 * 1. **The board is the authority on the rules.** Every move is committed with
 *    `playMoveFromUci`, the same call the analysis sidebar uses, so reveals,
 *    hidden-piece pools and end conditions come from one implementation. This
 *    runner never decides whether a move is legal.
 * 2. **The engines are never asked what the position is.** The position handed
 *    to an engine is produced by the board, not accumulated from the move list.
 *    A jieqi move reveals a piece whose identity was drawn at random; only the
 *    board knows it.
 * 3. **A finished game is written down before the next one starts.** The queue
 *    lives in SQLite, so an interrupted run resumes at the same game instead of
 *    replaying the last one or skipping it.
 *
 * Engines live in named slots (`engine-output:<slot>`), which is why two
 * different binaries can be loaded at once — the Rust side keeps a registry
 * rather than a single process handle. The default `engine-output` topic is
 * untouched, so the analysis sidebar never sees a tournament engine's chatter.
 */

// -------------------------------------------------------------- board bridge

/**
 * What the runner needs from the chess implementation. Registered by `App.vue`
 * on mount — the runner deliberately does not create its own game state,
 * because a second copy of the rules is a second answer to "is this legal".
 */
export interface TournamentBoardApi {
  /** Reset to the jieqi start position. */
  newGame: () => Promise<void> | void
  /** FEN in the engine's own format, with the hidden pool made explicit. */
  engineFen: () => string
  /** Commit a UCI move. `false` means the board rejected it. */
  play: (uci: string) => boolean
  /** Every legal move for the side to move, as UCI strings. */
  legalMoves: () => string[]
  sideToMove: () => 'red' | 'black'
  /** True when the side to move is in check (mate vs. stalemate). */
  inCheck: () => boolean
  /** Full jieqi FEN of the current position, for the record. */
  finalFen: () => string
}

let board: TournamentBoardApi | null = null

export function registerTournamentBoard(api: TournamentBoardApi) {
  board = api
}

// ------------------------------------------------------------------- limits

/**
 * Longest game the runner will play out. Engine-vs-engine jieqi has no
 * repetition rule implemented in the board, so a pair of engines that shuffles
 * for ever would otherwise never finish; 300 plies is 150 moves each, well past
 * any real game.
 */
const MAX_PLIES = 300

function goCommand(timeControl: string, value: number): string {
  switch (timeControl) {
    case 'nodes':
      return `go nodes ${value}`
    case 'depth':
      return `go depth ${value}`
    default:
      return `go movetime ${value}`
  }
}

/**
 * How long to wait for a `bestmove` before calling the search dead.
 *
 * Generous on purpose: a phone throttles after a few minutes of two engines at
 * full load, and a league run at night is exactly when that happens. Timing out
 * too eagerly would record losses that are the device's fault, not the
 * engine's.
 */
function moveTimeoutMs(timeControl: string, value: number): number {
  if (timeControl === 'movetime') return Math.max(30_000, value * 20)
  return 180_000
}

// ------------------------------------------------------------ engine session

type OptionValue = string | number | boolean

interface Waiter {
  test: (line: string) => boolean
  resolve: (line: string) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

class EngineSession {
  readonly slot: string
  private readonly entry: TournamentEntry
  private unlisten: UnlistenFn | null = null
  private buffer = ''
  private waiter: Waiter | null = null
  private exited = false

  constructor(entry: TournamentEntry) {
    this.entry = entry
    // One slot per entrant, so two entries that happen to share a binary still
    // get their own process and their own option set.
    this.slot = `tournament-${entry.id}`
  }

  get label() {
    return this.entry.name
  }

  async start(): Promise<void> {
    // Listen before spawning: `uciok` can arrive before `spawn_engine` returns.
    this.unlisten = await listen<string>(`engine-output:${this.slot}`, event =>
      this.feed(String(event.payload ?? ''))
    )

    const args = parseArgs(this.entry.args)
    await invoke('spawn_engine', {
      path: this.entry.path,
      args,
      engineId: this.slot,
    })

    this.send('uci')
    await this.waitFor(line => line.trim() === 'uciok', 30_000, 'uciok')

    // Option overrides come from the entry, not from the app's global engine
    // settings: a league has to be able to pin Hash and Threads per entrant,
    // otherwise the numbers on the leaderboard include the config changes the
    // user made halfway through.
    const options = parseOptions(this.entry.options)
    for (const [name, value] of Object.entries(options)) {
      this.send(
        typeof value === 'boolean'
          ? `setoption name ${name} value ${value}`
          : `setoption name ${name} value ${value}`
      )
    }
    this.send('isready')
    await this.waitFor(line => line.trim() === 'readyok', 15_000, 'readyok')
  }

  async newGame(): Promise<void> {
    this.send('ucinewgame')
    this.send('isready')
    await this.waitFor(line => line.trim() === 'readyok', 15_000, 'readyok')
  }

  /** Ask for one move. */
  async go(fen: string, timeControl: string, value: number): Promise<string> {
    this.send(`position fen ${fen}`)
    this.send(goCommand(timeControl, value))
    const timeout = moveTimeoutMs(timeControl, value)
    const line = await this.waitFor(
      text => text.startsWith('bestmove'),
      timeout,
      'bestmove'
    )
    const move = line.trim().split(/\s+/)[1] ?? ''
    return move
  }

  async dispose(): Promise<void> {
    if (this.exited) return
    this.exited = true
    const waiter = this.waiter
    this.waiter = null
    if (waiter) {
      clearTimeout(waiter.timer)
      waiter.reject(new Error('engine disposed'))
    }
    try {
      await invoke('kill_engine', { engineId: this.slot })
    } catch {
      /* the process is gone or was never there; nothing to do about it */
    }
    if (this.unlisten) {
      this.unlisten()
      this.unlisten = null
    }
  }

  private send(command: string) {
    invoke('send_to_engine', { command, engineId: this.slot }).catch(error => {
      // A write failing means the process died. The pending `bestmove` wait
      // will time out on its own; recording it here as well would only produce
      // two messages for one event.
      console.error(`[TOURNAMENT] write to ${this.label} failed:`, error)
    })
  }

  private feed(chunk: string) {
    this.buffer += chunk
    const lines = this.buffer.split(/\r?\n/)
    this.buffer = lines.pop() ?? ''
    for (const line of lines) this.dispatch(line)
    // Engines do not always terminate the last line before the interesting
    // token is needed (a lone `uciok` with no trailing newline is common).
    const tail = this.buffer.trim()
    if (tail) this.dispatch(tail)
  }

  private dispatch(line: string) {
    const text = line.trim()
    if (!text) return
    if (this.waiter && this.waiter.test(text)) {
      const waiter = this.waiter
      this.waiter = null
      clearTimeout(waiter.timer)
      waiter.resolve(text)
    }
  }

  private waitFor(
    test: (line: string) => boolean,
    timeoutMs: number,
    what: string
  ): Promise<string> {
    if (this.waiter) {
      return Promise.reject(new Error(`already waiting for a reply from ${this.label}`))
    }
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiter = null
        reject(new Error(`${this.label} did not answer ${what} in ${timeoutMs} ms`))
      }, timeoutMs)
      this.waiter = { test, resolve, reject, timer }
      // The token may already be sitting in the buffer from a previous chunk.
      const tail = this.buffer.trim()
      if (tail) this.dispatch(tail)
    })
  }
}

function parseArgs(raw: string): string[] {
  return raw
    .split(/\s+/)
    .map(part => part.trim())
    .filter(Boolean)
}

function parseOptions(raw: string | null): Record<string, OptionValue> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

// ------------------------------------------------------------ runner state

export type RunnerPhase = 'idle' | 'running' | 'paused' | 'finished'

const phase = ref<RunnerPhase>('idle')
const gameLabel = ref('')
const plyLabel = ref('')
const runLog = ref<string[]>([])
/** Last error worth showing the user; cleared when a run starts. */
const lastError = ref('')

let stopRequested = false

function pushLog(line: string) {
  runLog.value.unshift(`${new Date().toLocaleTimeString()} ${line}`)
  if (runLog.value.length > 200) runLog.value.pop()
}

export function useTournamentRunner() {
  return {
    phase,
    gameLabel,
    plyLabel,
    runLog,
    lastError,
    isRunning: () => phase.value === 'running',
  }
}

interface GameOutcome {
  request: GameResultInput | null
  /** True when the run was stopped mid-game: the slot goes back to the queue. */
  aborted: boolean
}

function resultFor(
  plan: GamePlan,
  winner: 'red' | 'black' | 'draw',
  reason: GameEndReason,
  plies: number,
  startedAt: number,
  finalFen: string
): GameResultInput {
  return {
    gameId: plan.gameId,
    result: winner,
    reason,
    moves: plies,
    durationMs: Date.now() - startedAt,
    finalFen,
  }
}

async function playOneGame(
  plan: GamePlan,
  sessions: Map<number, EngineSession>
): Promise<GameOutcome> {
  if (!board) throw new Error('tournament board is not registered')

  const startedAt = Date.now()
  const red = sessions.get(plan.red.id)
  const black = sessions.get(plan.black.id)
  if (!red || !black) throw new Error('engine sessions are not ready')

  // The draw seed is what makes a jieqi game reproducible, and the two games of
  // a colour-swapped pair share one: the only difference between them is which
  // engine held red.
  setBoardRngSeed(plan.seed)
  await board.newGame()

  await red.newGame()
  await black.newGame()

  let plies = 0
  let illegalBy: 'red' | 'black' | null = null
  let failed: { side: 'red' | 'black'; reason: GameEndReason } | null = null

  while (true) {
    if (stopRequested) {
      return { request: null, aborted: true }
    }

    const side = board.sideToMove()
    const legalMoves = board.legalMoves()

    if (legalMoves.length === 0) {
      // No legal moves: mate if the king is attacked, stalemate (a draw in
      // jieqi as in xiangqi) otherwise.
      const checked = board.inCheck()
      return {
        request: resultFor(
          plan,
          checked ? (side === 'red' ? 'black' : 'red') : 'draw',
          checked ? 'checkmate' : 'stalemate',
          plies,
          startedAt,
          board.finalFen()
        ),
        aborted: false,
      }
    }

    if (plies >= MAX_PLIES) {
      return {
        request: resultFor(plan, 'draw', 'adjudication', plies, startedAt, board.finalFen()),
        aborted: false,
      }
    }

    const engine = side === 'red' ? red : black
    const fen = board.engineFen()

    let move = ''
    try {
      move = await engine.go(fen, plan.timeControl, plan.timeValue)
    } catch (error) {
      failed = { side, reason: 'timeout' }
      pushLog(`${engine.label} 未在时限内给出应招：${(error as Error).message}`)
      plyLabel.value = `${plies} 手`
      return {
        request: resultFor(
          plan,
          side === 'red' ? 'black' : 'red',
          failed.reason,
          plies,
          startedAt,
          board.finalFen()
        ),
        aborted: false,
      }
    }

    if (!move || move === '(none)' || move === 'none') {
      // The engine says there is nothing to play here. Either it agrees with
      // the board that the game is over, or it is broken; the board decides,
      // and it says there is still a legal move.
      pushLog(`${engine.label} 返回空应招（${move || 'empty'}），判负`)
      return {
        request: resultFor(
          plan,
          side === 'red' ? 'black' : 'red',
          'noMove',
          plies,
          startedAt,
          board.finalFen()
        ),
        aborted: false,
      }
    }

    if (!board.play(move)) {
      illegalBy = side
      pushLog(`${engine.label} 走出非法招法 ${move}，判负`)
      return {
        request: resultFor(
          plan,
          side === 'red' ? 'black' : 'red',
          'illegalMove',
          plies,
          startedAt,
          board.finalFen()
        ),
        aborted: false,
      }
    }

    plies += 1
    plyLabel.value = `${plies} 手`
    void illegalBy
  }
}

/**
 * Replay a tournament from wherever it stopped.
 *
 * Idempotent by construction: it always asks Rust for the next *pending* game,
 * so calling `start` on a finished tournament does nothing and calling it on a
 * paused one picks up exactly where it left off.
 */
async function run(tournamentId: number) {
  if (phase.value === 'running') return
  const api = useTournament()
  const sessions = new Map<number, EngineSession>()
  stopRequested = false
  lastError.value = ''
  phase.value = 'running'
  ;(window as any).__TOURNAMENT_QUIET__ = true
  pushLog('联赛开始')

  try {
    await api.setStatus(tournamentId, 'running')

    while (!stopRequested) {
      const plan = await api.next(tournamentId)
      if (!plan) {
        phase.value = 'finished'
        await api.setStatus(tournamentId, 'finished')
        pushLog('全部对局结束')
        break
      }

      gameLabel.value = `${plan.red.name} (红) vs ${plan.black.name} (黑) · 第 ${
        plan.gameIndex + 1
      }/${plan.gamesInPairing} 局 · 种子 ${plan.seed}`
      plyLabel.value = '0 手'

      for (const entry of [plan.red, plan.black]) {
        if (!sessions.has(entry.id)) {
          const session = new EngineSession(entry)
          await session.start()
          sessions.set(entry.id, session)
          pushLog(`已加载引擎 ${entry.name}`)
        }
      }

      const outcome = await playOneGame(plan, sessions)
      if (outcome.aborted || !outcome.request) {
        // Stopping is not a result. Put the game back so the schedule keeps its
        // shape — a half-played game recorded as anything would be a lie.
        await api.release(plan.gameId)
        pushLog('已暂停，当前对局退回队列')
        break
      }

      await api.record(outcome.request)
      pushLog(
        `第 ${plan.pairIndex + 1} 组第 ${plan.gameIndex + 1} 局：${
          outcome.request.result === 'draw'
            ? '和棋'
            : outcome.request.result === 'red'
              ? '红胜'
              : '黑胜'
        }（${outcome.request.reason}，${outcome.request.moves} 手）`
      )
    }

    if (stopRequested && phase.value === 'running') {
      phase.value = 'paused'
      await api.setStatus(tournamentId, 'paused')
    }
  } catch (error) {
    phase.value = 'paused'
    lastError.value = (error as Error).message
    pushLog(`出错：${lastError.value}`)
    await api.setStatus(tournamentId, 'paused').catch(() => undefined)
  } finally {
    for (const session of sessions.values()) await session.dispose()
    sessions.clear()
    ;(window as any).__TOURNAMENT_QUIET__ = false
  }
}

function pause() {
  if (phase.value !== 'running') return
  stopRequested = true
}

function reset() {
  phase.value = 'idle'
  gameLabel.value = ''
  plyLabel.value = ''
}

/**
 * Stop the league and put any claimed game back in the queue without playing.
 * Used when the user closes the app or the screen: leaving a game `running` in
 * the database would block the schedule until the next open repairs it.
 */
async function abandon(tournamentId: number) {
  stopRequested = true
  const api = useTournament()
  await api.resetRunning(tournamentId).catch(() => undefined)
  await api.setStatus(tournamentId, 'paused').catch(() => undefined)
  phase.value = 'paused'
}

export function startTournament(tournamentId: number) {
  void run(tournamentId)
}

export function pauseTournament() {
  pause()
}

export function abandonTournament(tournamentId: number) {
  void abandon(tournamentId)
}

export function resetTournamentRunner() {
  reset()
}
