//! Career mode persistent store.
//!
//! Deliberately mirrors `opening_book.rs`: one `Connection` per command call,
//! `CREATE TABLE IF NOT EXISTS` on open, no global state. The only difference is
//! that this database is *irreplaceable* — a player's career history cannot be
//! regenerated — so it carries a `meta.schema_version` row and every future
//! shape change must go through `migrate` rather than a table rebuild.
//!
//! Division of responsibility:
//!   * **Rust owns** the numbers: rating deltas, aggregates, streak state,
//!     achievement unlocking. Anything here is authoritative.
//!   * **TypeScript owns** the labels: opponent names, titles (段位), bios.
//!     Nothing user-visible is hardcoded here, because the app ships 12 locales
//!     and this layer has no idea which one is active.

use rusqlite::{params, Connection, OptionalExtension, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;

/// Bump on any table shape change, and add the matching step in `migrate`.
pub const SCHEMA_VERSION: i32 = 1;

const DEFAULT_RATING: i32 = 1200;

/// Games shorter than this are not rated. A 4-move resignation (or a misclick
/// restart) must not move anyone's rating — otherwise farming is trivial.
const MIN_RATED_MOVES: i32 = 10;

/// Window used for the anti-farming damping below.
const DAMPING_WINDOW_MS: i64 = 24 * 60 * 60 * 1000;

// ----------------------------------------------------------------- payloads

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CareerProfile {
    pub nickname: String,
    pub avatar: String,
    /// Permanent title, e.g. won from a final. Rank names derived from `rating`
    /// are computed on the front end from the i18n bundle — not stored here.
    pub title: String,
    pub rating: i32,
    pub peak_rating: i32,
    pub coins: i32,
    pub games_played: i32,
    pub wins: i32,
    pub losses: i32,
    pub draws: i32,
    pub current_streak: i32,
    pub best_streak: i32,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveRecord {
    pub ply: i32,
    pub uci: String,
    pub fen: String,
    #[serde(default)]
    pub engine_score: Option<f64>,
    #[serde(default)]
    pub eval_drop: Option<f64>,
    #[serde(default)]
    pub quality: Option<String>,
    #[serde(default)]
    pub time_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewGameRequest {
    pub opponent_id: String,
    /// Opponent rating is supplied by the caller because the ladder (and its
    /// numbers) lives in TypeScript, next to the i18n keys.
    pub opponent_rating: i32,
    pub human_side: String,
    /// `win` | `loss` | `draw`
    pub result: String,
    pub moves: i32,
    pub duration_ms: i64,
    #[serde(default)]
    pub format: Option<String>,
    /// Caller may force `false` for games that must not count, e.g. the human
    /// let the engine play their side (`useAutoPlay`), or used a hint.
    #[serde(default)]
    pub rated: Option<bool>,
    /// RNG seed of the face-down draw sequence. Without it a jieqi game cannot
    /// be replayed, re-analysed or resampled for luck — see the design notes.
    #[serde(default)]
    pub fen_seed: Option<i64>,
    pub initial_fen: String,
    #[serde(default)]
    pub final_fen: Option<String>,
    #[serde(default)]
    pub luck_index: Option<i32>,
    #[serde(default)]
    pub xqf_path: Option<String>,
    #[serde(default)]
    pub season_id: Option<i64>,
    #[serde(default)]
    pub round_no: Option<i32>,
    #[serde(default)]
    pub moves_detail: Option<Vec<MoveRecord>>,
    /// Caller-supplied timestamp, so a queued offline game keeps its real date.
    #[serde(default)]
    pub created_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedGame {
    pub game_id: i64,
    pub profile: CareerProfile,
    pub rating_before: i32,
    pub rating_after: i32,
    pub rating_delta: i32,
    /// 1.0 when the first games against this opponent count in full; lower once
    /// the same opponent has been farmed.
    pub damping: f64,
    pub rated: bool,
    /// How much of `rating_delta` came from clearing the step for the first
    /// time. Reported separately so the player can tell skill from progress.
    pub clear_bonus: i32,
    /// Achievement ids unlocked by *this* game, so the UI can celebrate them.
    pub unlocked: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameSummary {
    pub id: i64,
    pub opponent_id: String,
    pub human_side: String,
    pub result: String,
    pub format: String,
    pub moves: i32,
    pub duration_ms: i64,
    pub rating_before: i32,
    pub rating_after: i32,
    pub rating_delta: i32,
    pub luck_index: Option<i32>,
    pub acpl: Option<f64>,
    pub fen_seed: Option<i64>,
    pub initial_fen: String,
    pub final_fen: Option<String>,
    pub xqf_path: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RatingPoint {
    pub game_id: i64,
    pub rating: i32,
    pub delta: i32,
    pub result: String,
    pub opponent_id: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpponentProgress {
    pub opponent_id: String,
    pub unlocked: bool,
    pub games: i32,
    pub wins: i32,
    pub losses: i32,
    pub draws: i32,
    pub first_cleared_at: Option<i64>,
    pub best_rating_delta: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CareerStats {
    pub profile: CareerProfile,
    pub win_rate: f64,
    pub avg_moves: f64,
    pub total_duration_ms: i64,
    pub avg_luck: Option<f64>,
    pub rating_history: Vec<RatingPoint>,
    pub recent: Vec<GameSummary>,
    pub opponents: Vec<OpponentProgress>,
    pub achievements: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CareerStoreInfo {
    pub db_path: String,
    pub schema_version: i32,
    pub games: i64,
}

// ----------------------------------------------------------- rating helpers

/// K-factor shrinks as the record grows: a new player's rating should find its
/// level quickly, an established one should not swing on a single game.
fn k_factor(games_played: i32) -> f64 {
    if games_played < 30 {
        40.0
    } else if games_played < 100 {
        24.0
    } else {
        16.0
    }
}

fn expected_score(my: f64, opponent: f64) -> f64 {
    1.0 / (1.0 + 10f64.powf((opponent - my) / 400.0))
}

fn score_for(result: &str) -> f64 {
    match result {
        "win" => 1.0,
        "draw" => 0.5,
        _ => 0.0,
    }
}

/// Diminishing returns against a repeat opponent inside the damping window.
/// Beating the same level-1 beginner eight times in an evening is not evidence
/// of improvement, and the rating should say so.
fn repeat_damping(recent_games_vs_opponent: i32) -> f64 {
    match recent_games_vs_opponent {
        i32::MIN..=2 => 1.0,
        3..=6 => 0.5,
        _ => 0.25,
    }
}

/// Bonus paid the first time a ladder step is cleared.
///
/// Pure Elo does not work for a ladder, and this was measured rather than
/// assumed: simulate a genuine 1600 player through the twelve steps and they
/// finish around 1430, because beating a 800-rated child is *correctly* worth
/// about +4 and the ladder only ever escalates. The rating therefore spends the
/// whole career trailing the player's real strength, and the player — who just
/// won a game and watched the number barely move — has no sense of progress.
///
/// So: expectation governs the rating, progress pays a bonus on top of it, and
/// the two are deliberately kept visible as separate numbers in the report.
/// The bonus scales with how far above the player the step sits, which keeps it
/// honest — beating a much weaker opponent still pays almost nothing, even the
/// first time.
fn first_clear_bonus(player: i32, opponent: i32) -> i32 {
    let headroom = (opponent - player).max(0) as f64;
    (18.0 + headroom * 0.45).min(100.0) as i32
}

// ------------------------------------------------------------------- store

pub struct CareerStore {
    conn: Connection,
}

impl CareerStore {
    pub fn new<P: AsRef<Path>>(db_path: P) -> Result<Self> {
        let conn = Connection::open(db_path)?;
        let store = CareerStore { conn };
        store.initialize_database()?;
        store.migrate()?;
        Ok(store)
    }

    fn initialize_database(&self) -> Result<()> {
        self.conn.execute_batch(
            r#"
            PRAGMA journal_mode = WAL;

            CREATE TABLE IF NOT EXISTS meta (
                key   TEXT PRIMARY KEY,
                value TEXT
            );

            CREATE TABLE IF NOT EXISTS profile (
                id             INTEGER PRIMARY KEY CHECK (id = 1),
                nickname       TEXT NOT NULL,
                avatar         TEXT NOT NULL,
                title          TEXT NOT NULL DEFAULT '',
                rating         INTEGER NOT NULL,
                peak_rating    INTEGER NOT NULL,
                coins          INTEGER NOT NULL DEFAULT 0,
                games_played   INTEGER NOT NULL DEFAULT 0,
                wins           INTEGER NOT NULL DEFAULT 0,
                losses         INTEGER NOT NULL DEFAULT 0,
                draws          INTEGER NOT NULL DEFAULT 0,
                current_streak INTEGER NOT NULL DEFAULT 0,
                best_streak    INTEGER NOT NULL DEFAULT 0,
                created_at     INTEGER NOT NULL,
                updated_at     INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS game (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                opponent_id    TEXT NOT NULL,
                opponent_rating INTEGER NOT NULL,
                season_id      INTEGER,
                round_no       INTEGER,
                format         TEXT NOT NULL DEFAULT 'standard',
                human_side     TEXT NOT NULL,
                result         TEXT NOT NULL,
                moves          INTEGER NOT NULL,
                duration_ms    INTEGER NOT NULL,
                rated          INTEGER NOT NULL DEFAULT 1,
                damping        REAL NOT NULL DEFAULT 1.0,
                rating_before  INTEGER NOT NULL,
                rating_after   INTEGER NOT NULL,
                rating_delta   INTEGER NOT NULL DEFAULT 0,
                luck_index     INTEGER,
                acpl           REAL,
                blunders       INTEGER DEFAULT 0,
                mistakes       INTEGER DEFAULT 0,
                inaccuracies   INTEGER DEFAULT 0,
                fen_seed       INTEGER,
                initial_fen    TEXT NOT NULL,
                final_fen      TEXT,
                xqf_path       TEXT,
                created_at     INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_game_created
                ON game (created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_game_opponent
                ON game (opponent_id, created_at DESC);

            CREATE TABLE IF NOT EXISTS move (
                game_id      INTEGER NOT NULL REFERENCES game(id) ON DELETE CASCADE,
                ply          INTEGER NOT NULL,
                uci          TEXT NOT NULL,
                fen          TEXT NOT NULL,
                engine_score REAL,
                eval_drop    REAL,
                quality      TEXT,
                time_ms      INTEGER,
                PRIMARY KEY (game_id, ply)
            );

            CREATE TABLE IF NOT EXISTS opponent_progress (
                opponent_id      TEXT PRIMARY KEY,
                unlocked         INTEGER NOT NULL DEFAULT 0,
                games            INTEGER NOT NULL DEFAULT 0,
                wins             INTEGER NOT NULL DEFAULT 0,
                losses           INTEGER NOT NULL DEFAULT 0,
                draws            INTEGER NOT NULL DEFAULT 0,
                first_cleared_at INTEGER,
                best_rating_delta INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS achievement (
                id          TEXT PRIMARY KEY,
                unlocked_at INTEGER NOT NULL
            );
            "#,
        )?;
        Ok(())
    }

    /// Version bookkeeping. v0 → v1 is the initial creation, so nothing to do
    /// yet; the shape of this function is the point (future changes append
    /// steps here instead of dropping player data).
    fn migrate(&self) -> Result<()> {
        let current: Option<String> = self
            .conn
            .query_row(
                "SELECT value FROM meta WHERE key = 'schema_version'",
                [],
                |row| row.get(0),
            )
            .optional()?;

        let current = current
            .and_then(|v| v.parse::<i32>().ok())
            .unwrap_or(0);

        if current < 1 {
            // Fresh database: profile row is created on demand by `read_profile`.
            self.conn.execute(
                "INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?1)",
                params![SCHEMA_VERSION.to_string()],
            )?;
        }

        // if current < 2 { ... future migration ... }

        Ok(())
    }

    // ------------------------------------------------------------- profile

    fn ensure_profile(&self) -> Result<()> {
        let exists: Option<i64> = self
            .conn
            .query_row("SELECT id FROM profile WHERE id = 1", [], |row| row.get(0))
            .optional()?;

        if exists.is_none() {
            let now = chrono::Utc::now().timestamp_millis();
            self.conn.execute(
                "INSERT INTO profile (id, nickname, avatar, title, rating, peak_rating,
                     coins, games_played, wins, losses, draws, current_streak,
                     best_streak, created_at, updated_at)
                 VALUES (1, ?1, ?2, '', ?3, ?3, 0, 0, 0, 0, 0, 0, 0, ?4, ?4)",
                params!["棋手", "reva", DEFAULT_RATING, now],
            )?;
        }
        Ok(())
    }

    pub fn get_profile(&self) -> Result<CareerProfile> {
        self.ensure_profile()?;
        read_profile(&self.conn)
    }

    pub fn update_profile(
        &self,
        nickname: Option<String>,
        avatar: Option<String>,
        title: Option<String>,
    ) -> Result<CareerProfile> {
        self.ensure_profile()?;
        let mut profile = read_profile(&self.conn)?;

        if let Some(v) = nickname.filter(|v| !v.trim().is_empty()) {
            profile.nickname = v.trim().chars().take(24).collect();
        }
        if let Some(v) = avatar.filter(|v| !v.trim().is_empty()) {
            profile.avatar = v;
        }
        if let Some(v) = title {
            profile.title = v;
        }

        self.conn.execute(
            "UPDATE profile SET nickname = ?1, avatar = ?2, title = ?3, updated_at = ?4
             WHERE id = 1",
            params![
                profile.nickname,
                profile.avatar,
                profile.title,
                chrono::Utc::now().timestamp_millis()
            ],
        )?;

        read_profile(&self.conn)
    }

    // ------------------------------------------------------------ save game

    pub fn save_game(&mut self, req: &NewGameRequest) -> Result<SavedGame> {
        self.ensure_profile()?;

        let now = req
            .created_at
            .unwrap_or_else(|| chrono::Utc::now().timestamp_millis());
        let format = req.format.clone().unwrap_or_else(|| "standard".to_string());

        let tx = self.conn.transaction()?;

        let mut profile = read_profile(&tx)?;

        // A game only moves the rating when the caller says so *and* it was long
        // enough to mean anything.
        let rated = req.rated.unwrap_or(true) && req.moves >= MIN_RATED_MOVES;

        let recent: i32 = tx.query_row(
            "SELECT COUNT(*) FROM game
             WHERE opponent_id = ?1 AND created_at > ?2",
            params![req.opponent_id, now - DAMPING_WINDOW_MS],
            |row| row.get(0),
        )?;
        let damping = repeat_damping(recent);

        let rating_before = profile.rating;
        let elo_delta = if rated {
            let k = k_factor(profile.games_played);
            let expected = expected_score(rating_before as f64, req.opponent_rating as f64);
            let score = score_for(&req.result);
            ((k * (score - expected)) * damping).round() as i32
        } else {
            0
        };

        // Has this step been cleared before? Only the first clear pays the
        // progress bonus; afterwards the game is worth plain Elo, which is what
        // the anti-farming damping above assumes.
        let already_cleared: bool = tx
            .query_row(
                "SELECT 1 FROM opponent_progress
                 WHERE opponent_id = ?1 AND first_cleared_at IS NOT NULL",
                params![req.opponent_id],
                |_| Ok(true),
            )
            .optional()?
            .unwrap_or(false);

        let clear_bonus = if rated && req.result == "win" && !already_cleared {
            first_clear_bonus(rating_before, req.opponent_rating)
        } else {
            0
        };

        let delta = elo_delta + clear_bonus;
        let rating_after = rating_before + delta;

        // ---- insert the game row
        tx.execute(
            "INSERT INTO game (
                opponent_id, opponent_rating, season_id, round_no, format, human_side,
                result, moves, duration_ms, rated, damping, rating_before, rating_after,
                rating_delta, luck_index, fen_seed, initial_fen, final_fen, xqf_path,
                created_at
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20)",
            params![
                req.opponent_id,
                req.opponent_rating,
                req.season_id,
                req.round_no,
                format,
                req.human_side,
                req.result,
                req.moves,
                req.duration_ms,
                if rated { 1 } else { 0 },
                damping,
                rating_before,
                rating_after,
                delta,
                req.luck_index,
                req.fen_seed,
                req.initial_fen,
                req.final_fen,
                req.xqf_path,
                now,
            ],
        )?;
        let game_id = tx.last_insert_rowid();

        // ---- per-move detail (M2's analysis reads this; recorded from day one
        // so early games are not missing it later)
        if let Some(moves) = &req.moves_detail {
            let mut stmt = tx.prepare(
                "INSERT INTO move (game_id, ply, uci, fen, engine_score, eval_drop, quality, time_ms)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            )?;
            for m in moves {
                stmt.execute(params![
                    game_id,
                    m.ply,
                    m.uci,
                    m.fen,
                    m.engine_score,
                    m.eval_drop,
                    m.quality,
                    m.time_ms,
                ])?;
            }
        }

        // ---- profile aggregates
        profile.games_played += 1;
        match req.result.as_str() {
            "win" => {
                profile.wins += 1;
                profile.current_streak += 1;
                if profile.current_streak > profile.best_streak {
                    profile.best_streak = profile.current_streak;
                }
            }
            "draw" => profile.draws += 1,
            _ => profile.losses += 1,
        }
        if req.result != "win" {
            profile.current_streak = 0;
        }
        if rated {
            profile.rating = rating_after;
            if rating_after > profile.peak_rating {
                profile.peak_rating = rating_after;
            }
        }
        profile.updated_at = now;

        tx.execute(
            "UPDATE profile SET rating = ?1, peak_rating = ?2, games_played = ?3,
                 wins = ?4, losses = ?5, draws = ?6, current_streak = ?7,
                 best_streak = ?8, updated_at = ?9
             WHERE id = 1",
            params![
                profile.rating,
                profile.peak_rating,
                profile.games_played,
                profile.wins,
                profile.losses,
                profile.draws,
                profile.current_streak,
                profile.best_streak,
                profile.updated_at,
            ],
        )?;

        // ---- opponent progress
        let cleared_at = if req.result == "win" { Some(now) } else { None };
        tx.execute(
            "INSERT INTO opponent_progress
                 (opponent_id, unlocked, games, wins, losses, draws, first_cleared_at, best_rating_delta)
             VALUES (?1, 1, 1,
                 CASE WHEN ?2 = 'win' THEN 1 ELSE 0 END,
                 CASE WHEN ?2 = 'loss' THEN 1 ELSE 0 END,
                 CASE WHEN ?2 = 'draw' THEN 1 ELSE 0 END,
                 ?3, ?4)
             ON CONFLICT(opponent_id) DO UPDATE SET
                 unlocked = 1,
                 games = games + 1,
                 wins = wins + CASE WHEN ?2 = 'win' THEN 1 ELSE 0 END,
                 losses = losses + CASE WHEN ?2 = 'loss' THEN 1 ELSE 0 END,
                 draws = draws + CASE WHEN ?2 = 'draw' THEN 1 ELSE 0 END,
                 first_cleared_at = COALESCE(first_cleared_at, ?3),
                 best_rating_delta = MAX(best_rating_delta, ?4)",
            params![req.opponent_id, req.result, cleared_at, delta],
        )?;

        // ---- achievements
        let mut unlocked = Vec::new();
        for candidate in achievement_candidates(&profile, req, rating_before, delta) {
            let inserted = tx.execute(
                "INSERT OR IGNORE INTO achievement (id, unlocked_at) VALUES (?1, ?2)",
                params![candidate, now],
            )?;
            if inserted > 0 {
                unlocked.push(candidate.to_string());
            }
        }

        tx.commit()?;

        Ok(SavedGame {
            game_id,
            profile,
            rating_before,
            // When the game is not rated, `delta` is already 0, so this is
            // `rating_before` and the two agree by construction.
            rating_after,
            rating_delta: delta,
            damping,
            rated,
            clear_bonus,
            unlocked,
        })
    }

    // --------------------------------------------------------------- queries

    pub fn list_games(&self, limit: i32, offset: i32) -> Result<Vec<GameSummary>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, opponent_id, human_side, result, format, moves, duration_ms,
                    rating_before, rating_after, rating_delta, luck_index, acpl,
                    fen_seed, initial_fen, final_fen, xqf_path, created_at
             FROM game ORDER BY created_at DESC, id DESC LIMIT ?1 OFFSET ?2",
        )?;

        let rows = stmt.query_map(params![limit, offset], |row| {
            Ok(GameSummary {
                id: row.get(0)?,
                opponent_id: row.get(1)?,
                human_side: row.get(2)?,
                result: row.get(3)?,
                format: row.get(4)?,
                moves: row.get(5)?,
                duration_ms: row.get(6)?,
                rating_before: row.get(7)?,
                rating_after: row.get(8)?,
                rating_delta: row.get(9)?,
                luck_index: row.get(10)?,
                acpl: row.get(11)?,
                fen_seed: row.get(12)?,
                initial_fen: row.get(13)?,
                final_fen: row.get(14)?,
                xqf_path: row.get(15)?,
                created_at: row.get(16)?,
            })
        })?;

        rows.collect()
    }

    pub fn get_stats(&self, history_limit: i32) -> Result<CareerStats> {
        let profile = self.get_profile()?;

        let (total, avg_moves, total_duration, avg_luck): (i64, Option<f64>, Option<i64>, Option<f64>) =
            self.conn.query_row(
                "SELECT COUNT(*), AVG(moves), SUM(duration_ms), AVG(luck_index) FROM game",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )?;

        let total_i32 = total as i32;
        let win_rate = if total_i32 > 0 {
            profile.wins as f64 / total_i32 as f64
        } else {
            0.0
        };

        let mut stmt = self.conn.prepare(
            "SELECT id, rating_after, rating_delta, result, opponent_id, created_at
             FROM game ORDER BY created_at DESC, id DESC LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![history_limit], |row| {
            Ok(RatingPoint {
                game_id: row.get(0)?,
                rating: row.get(1)?,
                delta: row.get(2)?,
                result: row.get(3)?,
                opponent_id: row.get(4)?,
                created_at: row.get(5)?,
            })
        })?;
        // Newest-first from SQL, oldest-first for the chart.
        let mut rating_history: Vec<RatingPoint> = rows.collect::<Result<Vec<_>>>()?;
        rating_history.reverse();

        let recent = self.list_games(10, 0)?;
        let opponents = self.opponent_progress()?;

        let mut stmt = self
            .conn
            .prepare("SELECT id FROM achievement ORDER BY unlocked_at ASC")?;
        let achievements = stmt
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<String>>>()?;

        Ok(CareerStats {
            profile,
            win_rate,
            avg_moves: avg_moves.unwrap_or(0.0),
            total_duration_ms: total_duration.unwrap_or(0),
            avg_luck,
            rating_history,
            recent,
            opponents,
            achievements,
        })
    }

    pub fn opponent_progress(&self) -> Result<Vec<OpponentProgress>> {
        let mut stmt = self.conn.prepare(
            "SELECT opponent_id, unlocked, games, wins, losses, draws,
                    first_cleared_at, best_rating_delta
             FROM opponent_progress",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(OpponentProgress {
                opponent_id: row.get(0)?,
                unlocked: row.get::<_, i32>(1)? == 1,
                games: row.get(2)?,
                wins: row.get(3)?,
                losses: row.get(4)?,
                draws: row.get(5)?,
                first_cleared_at: row.get(6)?,
                best_rating_delta: row.get(7)?,
            })
        })?;
        rows.collect()
    }

    /// Unlock a ladder opponent without playing (used when a player clears a
    /// step and the *next* card should light up).
    pub fn unlock_opponent(&self, opponent_id: &str) -> Result<()> {
        self.conn.execute(
            "INSERT INTO opponent_progress (opponent_id, unlocked) VALUES (?1, 1)
             ON CONFLICT(opponent_id) DO UPDATE SET unlocked = 1",
            params![opponent_id],
        )?;
        Ok(())
    }

    pub fn info(&self) -> Result<CareerStoreInfo> {
        let games: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM game", [], |row| row.get(0))?;
        Ok(CareerStoreInfo {
            db_path: String::new(), // filled in by the command layer
            schema_version: SCHEMA_VERSION,
            games,
        })
    }

    /// Wipe the career. Explicitly opt-in from the UI — never automatic.
    pub fn reset(&self) -> Result<()> {
        self.conn.execute_batch(
            "DELETE FROM move;
             DELETE FROM game;
             DELETE FROM opponent_progress;
             DELETE FROM achievement;
             DELETE FROM profile;",
        )?;
        self.ensure_profile()?;
        Ok(())
    }
}

// ------------------------------------------------------------------ helpers

fn read_profile(conn: &Connection) -> Result<CareerProfile> {
    conn.query_row(
        "SELECT nickname, avatar, title, rating, peak_rating, coins, games_played,
                wins, losses, draws, current_streak, best_streak, created_at, updated_at
         FROM profile WHERE id = 1",
        [],
        |row| {
            Ok(CareerProfile {
                nickname: row.get(0)?,
                avatar: row.get(1)?,
                title: row.get(2)?,
                rating: row.get(3)?,
                peak_rating: row.get(4)?,
                coins: row.get(5)?,
                games_played: row.get(6)?,
                wins: row.get(7)?,
                losses: row.get(8)?,
                draws: row.get(9)?,
                current_streak: row.get(10)?,
                best_streak: row.get(11)?,
                created_at: row.get(12)?,
                updated_at: row.get(13)?,
            })
        },
    )
}

/// Which achievements this game satisfies. Kept as a plain function so the
/// rules are readable in one place and unit-testable without a database.
fn achievement_candidates(
    profile: &CareerProfile,
    req: &NewGameRequest,
    rating_before: i32,
    delta: i32,
) -> Vec<&'static str> {
    let mut out = Vec::new();

    if req.result == "win" {
        if profile.wins == 1 {
            out.push("first_win");
        }
        if profile.current_streak >= 5 {
            out.push("streak_5");
        }
        if profile.current_streak >= 10 {
            out.push("streak_10");
        }
        // Beating someone rated far above you.
        if req.opponent_rating - rating_before >= 300 {
            out.push("upset_300");
        }
        // Won despite the draws running against them.
        if req.luck_index.is_some_and(|l| l <= -30) {
            out.push("lucky_punch");
        }
        if req.moves <= 20 {
            out.push("quick_win");
        }
        if req.moves >= 80 {
            out.push("marathon_win");
        }
    }

    // Big single-game gains imply an upset against a strong opponent.
    if delta >= 25 {
        out.push("big_jump");
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn damping_kicks_in_for_repeat_opponents() {
        assert_eq!(repeat_damping(0), 1.0);
        assert_eq!(repeat_damping(2), 1.0);
        assert_eq!(repeat_damping(3), 0.5);
        assert_eq!(repeat_damping(9), 0.25);
    }

    #[test]
    fn k_factor_shrinks_with_experience() {
        assert_eq!(k_factor(0), 40.0);
        assert_eq!(k_factor(50), 24.0);
        assert_eq!(k_factor(500), 16.0);
    }

    #[test]
    fn equal_players_split_the_expected_score() {
        let e = expected_score(1500.0, 1500.0);
        assert!((e - 0.5).abs() < 1e-9);
    }

    #[test]
    fn beating_a_stronger_opponent_pays_more() {
        let k = 24.0;
        let weak_win = k * (1.0 - expected_score(1200.0, 1600.0));
        let even_win = k * (1.0 - expected_score(1200.0, 1200.0));
        assert!(weak_win > even_win);
    }
}

#[cfg(test)]
mod db_tests {
    use super::*;

    fn temp_db() -> String {
        let mut p = std::env::temp_dir();
        p.push(format!(
            "career_test_{}_{}.db",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0)
        ));
        p.to_string_lossy().to_string()
    }

    fn request(opponent_id: &str, result: &str, moves: i32) -> NewGameRequest {
        NewGameRequest {
            opponent_id: opponent_id.to_string(),
            opponent_rating: 1500,
            human_side: "red".to_string(),
            result: result.to_string(),
            moves,
            duration_ms: 60_000,
            format: None,
            rated: Some(true),
            fen_seed: Some(42),
            initial_fen: "start".to_string(),
            final_fen: None,
            luck_index: None,
            xqf_path: None,
            season_id: None,
            round_no: None,
            moves_detail: None,
            created_at: None,
        }
    }

    #[test]
    fn fresh_profile_starts_at_default_rating() {
        let store = CareerStore::new(temp_db()).unwrap();
        let p = store.get_profile().unwrap();
        assert_eq!(p.rating, DEFAULT_RATING);
        assert_eq!(p.games_played, 0);
    }

    #[test]
    fn winning_against_a_stronger_opponent_raises_the_rating() {
        let mut store = CareerStore::new(temp_db()).unwrap();
        let saved = store.save_game(&request("grandmaster", "win", 40)).unwrap();
        assert!(saved.rated);
        assert!(saved.rating_delta > 0);
        assert_eq!(saved.rating_after, DEFAULT_RATING + saved.rating_delta);
        assert!(saved.unlocked.iter().any(|a| a == "first_win"));
        let p = store.get_profile().unwrap();
        assert_eq!(p.wins, 1);
        assert_eq!(p.games_played, 1);
    }

    #[test]
    fn short_games_are_recorded_but_not_rated() {
        let mut store = CareerStore::new(temp_db()).unwrap();
        let saved = store.save_game(&request("child_beginner", "win", 3)).unwrap();
        assert!(!saved.rated);
        assert_eq!(saved.rating_delta, 0);
        assert_eq!(saved.profile.rating, DEFAULT_RATING);
        assert_eq!(saved.profile.wins, 1);
        assert_eq!(store.list_games(10, 0).unwrap().len(), 1);
    }

    #[test]
    fn repeat_opponents_are_damped() {
        let mut store = CareerStore::new(temp_db()).unwrap();
        let first = store.save_game(&request("park_regular", "win", 40)).unwrap();
        assert_eq!(first.damping, 1.0);
        let _ = store.save_game(&request("park_regular", "win", 40)).unwrap();
        let _ = store.save_game(&request("park_regular", "win", 40)).unwrap();
        let fourth = store.save_game(&request("park_regular", "win", 40)).unwrap();
        assert_eq!(fourth.damping, 0.5);
        assert!(fourth.rating_delta < first.rating_delta);
    }

    #[test]
    fn stats_report_the_rating_history_in_play_order() {
        let mut store = CareerStore::new(temp_db()).unwrap();
        store.save_game(&request("child_beginner", "win", 40)).unwrap();
        store.save_game(&request("child_beginner", "loss", 40)).unwrap();
        let stats = store.get_stats(50).unwrap();
        assert_eq!(stats.rating_history.len(), 2);
        assert!(stats.rating_history[0].created_at <= stats.rating_history[1].created_at);
        assert_eq!(stats.recent.len(), 2);
        assert!(stats.rating_history[1].rating < stats.rating_history[0].rating);
    }

    #[test]
    fn opponent_progress_records_a_clear() {
        let mut store = CareerStore::new(temp_db()).unwrap();
        store.save_game(&request("reva", "loss", 40)).unwrap();
        let progress = store.opponent_progress().unwrap();
        let reva = progress.iter().find(|p| p.opponent_id == "reva").unwrap();
        assert_eq!(reva.losses, 1);
        assert!(reva.first_cleared_at.is_none());

        store.save_game(&request("reva", "win", 40)).unwrap();
        let progress = store.opponent_progress().unwrap();
        let reva = progress.iter().find(|p| p.opponent_id == "reva").unwrap();
        assert_eq!(reva.wins, 1);
        assert!(reva.first_cleared_at.is_some());
    }

    #[test]
    fn move_detail_round_trips() {
        let mut store = CareerStore::new(temp_db()).unwrap();
        let mut req = request("reva", "win", 40);
        req.moves_detail = Some(vec![
            MoveRecord { ply: 1, uci: "a0a1".into(), fen: "f1".into(), engine_score: Some(12.0), ..Default::default() },
            MoveRecord { ply: 2, uci: "a1a2".into(), fen: "f2".into(), engine_score: Some(-8.0), ..Default::default() },
        ]);
        let saved = store.save_game(&req).unwrap();
        let count: i64 = store
            .conn
            .query_row("SELECT COUNT(*) FROM move WHERE game_id = ?1", params![saved.game_id], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 2);
    }

    #[test]
    fn reset_clears_everything_but_keeps_a_profile() {
        let mut store = CareerStore::new(temp_db()).unwrap();
        store.save_game(&request("reva", "win", 40)).unwrap();
        store.reset().unwrap();
        let p = store.get_profile().unwrap();
        assert_eq!(p.games_played, 0);
        assert_eq!(p.rating, DEFAULT_RATING);
        assert!(store.list_games(10, 0).unwrap().is_empty());
    }

    #[test]
    fn clear_bonus_scales_with_how_far_above_you_the_step_sits() {
        // A step below you pays only the floor; the bonus is about progress,
        // not about beating someone weaker.
        assert_eq!(first_clear_bonus(1600, 900), 18);
        assert!(first_clear_bonus(1200, 1800) > first_clear_bonus(1200, 900));
        // and it is capped, so one lucky win cannot launch a career
        assert_eq!(first_clear_bonus(1000, 2600), 100);
    }

    #[test]
    fn first_clear_pays_the_bonus_once_and_never_again() {
        let mut store = CareerStore::new(temp_db()).unwrap();
        let first = store.save_game(&request("city_champion", "win", 40)).unwrap();
        assert!(first.clear_bonus > 0);
        assert_eq!(first.rating_delta, first.clear_bonus + unbonused_delta());

        let repeat = store.save_game(&request("city_champion", "win", 40)).unwrap();
        assert_eq!(repeat.clear_bonus, 0);
        // A repeat win is worth plain (damped) Elo — nowhere near the first.
        assert!(repeat.rating_delta < first.rating_delta);
    }

    #[test]
    fn losing_never_pays_a_clear_bonus() {
        let mut store = CareerStore::new(temp_db()).unwrap();
        let saved = store.save_game(&request("jieqi_god", "loss", 40)).unwrap();
        assert_eq!(saved.clear_bonus, 0);
        assert!(saved.rating_delta <= 0);
    }

    /// What the delta would have been with no bonus at all: a 1500-rated
    /// opponent against a 1200 start, so a win is worth most of K.
    fn unbonused_delta() -> i32 {
        let k = k_factor(0);
        let expected = expected_score(DEFAULT_RATING as f64, 1500.0);
        (k * (1.0 - expected)).round() as i32
    }
}
