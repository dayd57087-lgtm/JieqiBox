import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import type {
  GamePlan,
  GameResultInput,
  Standing,
  TournamentConfig,
  TournamentDetail,
  TournamentGameRecord,
  TournamentStatus,
  TournamentSummary,
} from '@/types/tournament'

/**
 * Thin wrapper over the Rust tournament commands, plus the shared open/closed
 * state of the tournament screen.
 *
 * No logic lives here — the schedule and the ratings are decided in Rust, and
 * this file's only job is to not add a second opinion on the way through. The
 * one thing it does own is `isTournamentViewOpen`, because the drawer item that
 * opens the overlay lives inside the analysis deck while the overlay itself is
 * rendered by `App.vue`; a module-level ref keeps that a one-line wire-up
 * instead of threading an emit through two component layers.
 */

const isTournamentViewOpen = ref(false)

/** Read-only view for components that only need to raise or lower the overlay. */
export function useTournamentUI() {
  return { isTournamentViewOpen }
}

export function useTournament() {
  const create = (config: TournamentConfig) =>
    invoke<TournamentSummary>('tournament_create', { config })

  const list = () => invoke<TournamentSummary[]>('tournament_list')

  const get = (id: number) => invoke<TournamentDetail>('tournament_get', { id })

  /** Claims the next game. `null` means the schedule is finished. */
  const next = (id: number) =>
    invoke<GamePlan | null>('tournament_next_game', { id })

  const release = (gameId: number) =>
    invoke<void>('tournament_release_game', { gameId })

  const record = (request: GameResultInput) =>
    invoke<void>('tournament_record_game', { request })

  const games = (id: number) =>
    invoke<TournamentGameRecord[]>('tournament_games', { id })

  const standings = (id: number) =>
    invoke<Standing[]>('tournament_standings', { id })

  const setStatus = (id: number, status: TournamentStatus) =>
    invoke<void>('tournament_set_status', { id, status })

  const resetRunning = (id: number) =>
    invoke<void>('tournament_reset_running', { id })

  const exportAll = (id: number) => invoke<string>('tournament_export', { id })

  const remove = (id: number) =>
    invoke<void>('tournament_delete', { id, confirm: 'DELETE' })

  return {
    create,
    list,
    get,
    next,
    release,
    record,
    games,
    standings,
    setStatus,
    resetRunning,
    exportAll,
    remove,
  }
}
