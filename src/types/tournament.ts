/**
 * Payload shapes of the engine-tournament commands.
 *
 * These mirror `src-tauri/src/tournament.rs` one for one (serde renames every
 * field to camelCase). They are hand-written rather than generated, so when the
 * Rust structs change, this file is the thing that has to be changed with them.
 */

export type TournamentFormat = 'gauntlet' | 'roundRobin'
export type TimeControl = 'movetime' | 'nodes' | 'depth'
export type TournamentStatus = 'draft' | 'running' | 'paused' | 'finished'

/** Why a game ended. `void` reasons keep the game out of the ratings. */
export type GameEndReason =
  | 'checkmate'
  | 'stalemate'
  | 'noLegalMove'
  | 'repetition'
  | 'fiftyMove'
  | 'adjudication'
  | 'illegalMove'
  | 'crash'
  | 'timeout'
  | 'noMove'
  | 'aborted'

export interface TournamentEntryInput {
  name: string
  path: string
  args?: string
  /** JSON string of the USI option overrides this entry is pinned to. */
  options?: string | null
  fingerprint?: string | null
}

export interface TournamentConfig {
  name: string
  format: TournamentFormat
  timeControl: TimeControl
  timeValue: number
  gamesPerPairing?: number
  seed?: number
  openingPlies?: number
  maxGames?: number
  entries: TournamentEntryInput[]
}

export interface TournamentEntry {
  id: number
  slot: number
  name: string
  path: string
  args: string
  options: string | null
  fingerprint: string | null
}

export interface TournamentSummary {
  id: number
  name: string
  format: TournamentFormat
  timeControl: TimeControl
  timeValue: number
  gamesPerPairing: number
  seed: number
  openingPlies: number
  status: TournamentStatus
  createdAt: number
  updatedAt: number
  entries: number
  gamesTotal: number
  gamesDone: number
  gamesVoid: number
}

export interface TournamentDetail {
  tournament: TournamentSummary
  entrants: TournamentEntry[]
}

/** One scheduled game, claimed from the queue. */
export interface GamePlan {
  gameId: number
  tournamentId: number
  pairIndex: number
  gameIndex: number
  /** Draw seed for the face-down pieces. Shared by a colour-swapped pair. */
  seed: number
  red: TournamentEntry
  black: TournamentEntry
  timeControl: TimeControl
  timeValue: number
  openingPlies: number
  gamesInPairing: number
}

export interface GameResultInput {
  gameId: number
  result: 'red' | 'black' | 'draw'
  reason: GameEndReason
  moves: number
  durationMs: number
  finalFen?: string | null
  /** Keep the game out of the ratings while still occupying its slot. */
  void?: boolean
}

export interface Standing {
  entryId: number
  name: string
  slot: number
  fingerprint: string | null
  games: number
  wins: number
  losses: number
  draws: number
  scoreRate: number
  rating: number
  provisional: boolean
}

export interface TournamentGameRecord {
  id: number
  pairIndex: number
  gameIndex: number
  redEntry: number
  blackEntry: number
  seed: number
  status: 'pending' | 'running' | 'done' | 'void'
  result: 'red' | 'black' | 'draw' | null
  reason: string | null
  moves: number | null
  durationMs: number | null
  finalFen: string | null
  finishedAt: number | null
}
