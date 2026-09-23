import { ref, computed } from 'vue'
import { invoke } from '@tauri-apps/api/core'

/**
 * Career profile and statistics.
 *
 * Everything here is a thin reactive mirror of `career.rs`. The Rust side is
 * authoritative for every number: rating, deltas, streaks, achievements. This
 * file never recomputes a rating locally — it would drift from the store the
 * moment two games are settled in the same session.
 *
 * Rank *names* are the one exception: they are derived here from the rating so
 * that all 12 locales work without the backend knowing about any of them.
 */

export interface CareerProfile {
  nickname: string
  avatar: string
  title: string
  rating: number
  peakRating: number
  coins: number
  gamesPlayed: number
  wins: number
  losses: number
  draws: number
  currentStreak: number
  bestStreak: number
  createdAt: number
  updatedAt: number
}

export interface GameSummary {
  id: number
  opponentId: string
  humanSide: 'red' | 'black'
  result: 'win' | 'loss' | 'draw'
  format: string
  moves: number
  durationMs: number
  ratingBefore: number
  ratingAfter: number
  ratingDelta: number
  luckIndex: number | null
  acpl: number | null
  fenSeed: number | null
  initialFen: string
  finalFen: string | null
  xqfPath: string | null
  createdAt: number
}

export interface RatingPoint {
  gameId: number
  rating: number
  delta: number
  result: 'win' | 'loss' | 'draw'
  opponentId: string
  createdAt: number
}

export interface OpponentProgress {
  opponentId: string
  unlocked: boolean
  games: number
  wins: number
  losses: number
  draws: number
  firstClearedAt: number | null
  bestRatingDelta: number
}

export interface CareerStats {
  profile: CareerProfile
  winRate: number
  avgMoves: number
  totalDurationMs: number
  avgLuck: number | null
  ratingHistory: RatingPoint[]
  recent: GameSummary[]
  opponents: OpponentProgress[]
  achievements: string[]
}

export interface SavedGame {
  gameId: number
  profile: CareerProfile
  ratingBefore: number
  ratingAfter: number
  ratingDelta: number
  damping: number
  rated: boolean
  /** Part of `ratingDelta` that came from clearing this step for the first time. */
  clearBonus: number
  unlocked: string[]
}

export interface MoveRecord {
  ply: number
  uci: string
  fen: string
  engineScore?: number | null
  evalDrop?: number | null
  quality?: string | null
  timeMs?: number | null
}

export interface NewGameRequest {
  opponentId: string
  opponentRating: number
  humanSide: 'red' | 'black'
  result: 'win' | 'loss' | 'draw'
  moves: number
  durationMs: number
  format?: string
  rated?: boolean
  fenSeed?: number | null
  initialFen: string
  finalFen?: string | null
  luckIndex?: number | null
  xqfPath?: string | null
  seasonId?: number | null
  roundNo?: number | null
  movesDetail?: MoveRecord[]
  createdAt?: number | null
}

/**
 * Rank ladder. Points are the *lower bound* of each band; the last matching
 * entry wins. Keys resolve through i18n (`career.rank.<key>`), so translations
 * are never baked into logic.
 */
export const RANK_LADDER: Array<{ min: number; key: string }> = [
  { min: 2500, key: 'grandmaster' },
  { min: 2300, key: 'master' },
  { min: 2100, key: 'provincial' },
  { min: 1900, key: 'city_champion' },
  { min: 1700, key: 'city_strong' },
  { min: 1450, key: 'amateur_dan' },
  { min: 1200, key: 'amateur_high' },
  { min: 1000, key: 'amateur_mid' },
  { min: 800, key: 'amateur_low' },
  { min: 0, key: 'beginner' },
]

export function rankKeyForRating(rating: number): string {
  const band = RANK_LADDER.find(r => rating >= r.min)
  return band ? band.key : 'beginner'
}

/** Progress through the current rank band, 0..1 — for the profile ring. */
export function rankProgress(rating: number): number {
  const idx = RANK_LADDER.findIndex(r => rating >= r.min)
  if (idx <= 0) return 1
  const lower = RANK_LADDER[idx].min
  const upper = RANK_LADDER[idx - 1].min
  if (upper <= lower) return 1
  return Math.max(0, Math.min(1, (rating - lower) / (upper - lower)))
}

const profile = ref<CareerProfile | null>(null)
const stats = ref<CareerStats | null>(null)
const isLoading = ref(false)
const lastError = ref<string | null>(null)

/** Set when a `career_save_game` call returns — the UI reads it once, then
 *  clears it, so the post-game report survives a component remount. */
const pendingResult = ref<SavedGame | null>(null)

export function useCareer() {
  const isInitialised = computed(() => profile.value !== null)

  const winRate = computed(() => {
    const p = profile.value
    if (!p || p.gamesPlayed === 0) return 0
    return p.wins / p.gamesPlayed
  })

  const rankKey = computed(() =>
    rankKeyForRating(profile.value?.rating ?? 1200)
  )
  const progress = computed(() => rankProgress(profile.value?.rating ?? 1200))

  const loadProfile = async (): Promise<CareerProfile | null> => {
    isLoading.value = true
    lastError.value = null
    try {
      profile.value = await invoke<CareerProfile>('career_get_profile')
      return profile.value
    } catch (e: any) {
      lastError.value = String(e)
      console.error('[career] failed to load profile:', e)
      return null
    } finally {
      isLoading.value = false
    }
  }

  const loadStats = async (historyLimit = 200): Promise<CareerStats | null> => {
    isLoading.value = true
    lastError.value = null
    try {
      const result = await invoke<CareerStats>('career_get_stats', {
        historyLimit,
      })
      stats.value = result
      profile.value = result.profile
      return result
    } catch (e: any) {
      lastError.value = String(e)
      console.error('[career] failed to load stats:', e)
      return null
    } finally {
      isLoading.value = false
    }
  }

  const updateProfile = async (patch: {
    nickname?: string
    avatar?: string
    title?: string
  }): Promise<CareerProfile | null> => {
    try {
      const updated = await invoke<CareerProfile>('career_update_profile', {
        nickname: patch.nickname ?? null,
        avatar: patch.avatar ?? null,
        title: patch.title ?? null,
      })
      profile.value = updated
      return updated
    } catch (e: any) {
      lastError.value = String(e)
      console.error('[career] failed to update profile:', e)
      return null
    }
  }

  const listGames = async (limit = 50, offset = 0): Promise<GameSummary[]> => {
    try {
      return await invoke<GameSummary[]>('career_list_games', {
        limit,
        offset,
      })
    } catch (e: any) {
      lastError.value = String(e)
      console.error('[career] failed to list games:', e)
      return []
    }
  }

  const listOpponentProgress = async (): Promise<OpponentProgress[]> => {
    try {
      return await invoke<OpponentProgress[]>('career_opponent_progress')
    } catch (e: any) {
      lastError.value = String(e)
      console.error('[career] failed to load opponent progress:', e)
      return []
    }
  }

  const unlockOpponent = async (opponentId: string): Promise<void> => {
    try {
      await invoke('career_unlock_opponent', { opponentId })
    } catch (e: any) {
      console.error('[career] failed to unlock opponent:', e)
    }
  }

  /** Commit a finished game. Rust settles the rating inside one transaction. */
  const saveGame = async (
    request: NewGameRequest
  ): Promise<SavedGame | null> => {
    try {
      const saved = await invoke<SavedGame>('career_save_game', { request })
      profile.value = saved.profile
      pendingResult.value = saved
      // The dashboard is now stale; refresh it lazily on next open rather than
      // blocking the end-of-game dialog on a stats query.
      stats.value = null
      return saved
    } catch (e: any) {
      lastError.value = String(e)
      console.error('[career] failed to save game:', e)
      return null
    }
  }

  const takePendingResult = (): SavedGame | null => {
    const r = pendingResult.value
    pendingResult.value = null
    return r
  }

  const exportCareer = async (): Promise<string | null> => {
    try {
      return await invoke<string>('career_export')
    } catch (e: any) {
      lastError.value = String(e)
      console.error('[career] failed to export:', e)
      return null
    }
  }

  /** Destructive. The Rust side requires the literal confirm string. */
  const resetCareer = async (): Promise<boolean> => {
    try {
      await invoke('career_reset', { confirm: 'RESET' })
      profile.value = null
      stats.value = null
      pendingResult.value = null
      await loadProfile()
      return true
    } catch (e: any) {
      lastError.value = String(e)
      console.error('[career] failed to reset:', e)
      return false
    }
  }

  return {
    // state
    profile,
    stats,
    isLoading,
    lastError,
    pendingResult,
    // derived
    isInitialised,
    winRate,
    rankKey,
    progress,
    // actions
    loadProfile,
    loadStats,
    updateProfile,
    listGames,
    listOpponentProgress,
    unlockOpponent,
    saveGame,
    takePendingResult,
    exportCareer,
    resetCareer,
  }
}
