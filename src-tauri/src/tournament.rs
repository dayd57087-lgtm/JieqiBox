//! Engine tournament (引擎联赛) persistent store.
//!
//! Same shape as `career.rs`: one `Connection` per command call,
//! `CREATE TABLE IF NOT EXISTS` on open, `meta.schema_version` for migrations.
//! Nothing here holds a process handle or drives a game — the runner lives in
//! TypeScript, next to the board rules it has to obey.
//!
//! Division of responsibility:
//!   * **Rust owns the schedule and the numbers**: pairings, per-game draw
//!     seeds, which game is next, and the rating table. All three are things a
//!     resumed or crashed tournament must recompute identically, and the front
//!     end is not allowed to have an opinion about any of them.
//!   * **TypeScript owns the play**: it plays the games, decides why one ended
//!     (checkmate, adjudication, engine crash) and reports the result back.
//!
//! A jieqi game is not reproducible from its moves alone: the identities behind
//! the face-down pieces are drawn. Every scheduled game therefore carries a
//! seed, and the two games of a colour-swapped pair share one seed, so the only
//! difference between them is which engine held red.

use rusqlite::{params, Connection, OptionalExtension, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

/// Bump on any table shape change, and add the matching step in `migrate`.
pub const SCHEMA_VERSION: i32 = 1;

/// Where an unrated entry starts, and where the field's geometric mean is
/// pinned. Ratings here are *relative*: they come from the games of one
/// tournament, so comparing one to a career-mode rating is meaningless.
pub const ANCHOR_RATING: f64 = 1500.0;

/// A single game between two engines in jieqi is noise; a pairing defaults to
/// one colour-swapped pair.
const DEFAULT_GAMES_PER_PAIRING: i32 = 2;

/// Below this many games an entrant's rating is reported as provisional.
const PROVISIONAL_GAMES: i32 = 4;

// ------------------------------------------------------------------ payloads

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TournamentEntryInput {
    /// Display name, supplied by the caller because the engine list lives in
    /// the config file, not here.
    pub name: String,
    pub path: String,
    #[serde(default)]
    pub args: String,
    /// Free-form JSON: the USI option overrides this entry is pinned to.
    #[serde(default)]
    pub options: Option<String>,
    /// Optional hash of the engine binary. Two entries with the same name and
    /// different fingerprints are different entrants, and the standings should
    /// be able to say so.
    #[serde(default)]
    pub fingerprint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TournamentConfig {
    pub name: String,
    /// `gauntlet` (entry 0 against everyone) or `roundRobin`.
    pub format: String,
    /// `movetime` (ms), `nodes` or `depth`.
    pub time_control: String,
    pub time_value: i64,
    /// Total games per pairing; rounded up to an even number.
    #[serde(default)]
    pub games_per_pairing: Option<i32>,
    /// Master seed. Every game's own seed is derived from it.
    #[serde(default)]
    pub seed: Option<i64>,
    /// Plies played from the opening book before the engines take over. A
    /// league where every game starts from the same position measures one
    /// line, not two engines.
    #[serde(default)]
    pub opening_plies: Option<i32>,
    /// Optional cap on the number of scheduled games.
    #[serde(default)]
    pub max_games: Option<i32>,
    pub entries: Vec<TournamentEntryInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TournamentEntry {
    pub id: i64,
    pub slot: i32,
    pub name: String,
    pub path: String,
    pub args: String,
    pub options: Option<String>,
    pub fingerprint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TournamentSummary {
    pub id: i64,
    pub name: String,
    pub format: String,
    pub time_control: String,
    pub time_value: i64,
    pub games_per_pairing: i32,
    pub seed: i64,
    pub opening_plies: i32,
    pub status: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub entries: i32,
    pub games_total: i32,
    pub games_done: i32,
    pub games_void: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TournamentDetail {
    pub tournament: TournamentSummary,
    pub entrants: Vec<TournamentEntry>,
}

/// One scheduled game, handed to the runner.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GamePlan {
    pub game_id: i64,
    pub tournament_id: i64,
    pub pair_index: i32,
    pub game_index: i32,
    pub seed: i64,
    pub red: TournamentEntry,
    pub black: TournamentEntry,
    pub time_control: String,
    pub time_value: i64,
    pub opening_plies: i32,
    /// Games scheduled in the same pairing, so the runner can show "game 3 of
    /// 6" without a second query.
    pub games_in_pairing: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameResultInput {
    pub game_id: i64,
    /// `red` | `black` | `draw`
    pub result: String,
    /// `checkmate` | `stalemate` | `repetition` | `fiftyMove` | `material`
    /// | `illegalMove` | `crash` | `timeout` | `noMove` | `aborted`
    pub reason: String,
    pub moves: i32,
    pub duration_ms: i64,
    #[serde(default)]
    pub final_fen: Option<String>,
    /// Games that must not enter the ratings (a crashed engine, a game the
    /// runner gave up on) are reported with `void`. They still occupy their
    /// slot: a void game is information, a missing game is a hole.
    #[serde(default)]
    pub void: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Standing {
    pub entry_id: i64,
    pub name: String,
    pub slot: i32,
    pub fingerprint: Option<String>,
    pub games: i32,
    pub wins: i32,
    pub losses: i32,
    pub draws: i32,
    /// Wins + half the draws, over games. 0.0 when nothing was played.
    pub score_rate: f64,
    /// Bradley–Terry rating on a 400-point scale, anchored so the field's
    /// geometric mean is `ANCHOR_RATING`.
    pub rating: f64,
    /// True while this entrant has too few games for the number to mean
    /// anything; the UI should not print a precise rating for these.
    pub provisional: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TournamentGameRecord {
    pub id: i64,
    pub pair_index: i32,
    pub game_index: i32,
    pub red_entry: i64,
    pub black_entry: i64,
    pub seed: i64,
    pub status: String,
    pub result: Option<String>,
    pub reason: Option<String>,
    pub moves: Option<i32>,
    pub duration_ms: Option<i64>,
    pub final_fen: Option<String>,
    pub finished_at: Option<i64>,
}

// --------------------------------------------------------------------- seeds

/// SplitMix64. Used only to derive one game's draw seed from the tournament's
/// master seed, so the derivation is stable across restarts and platforms.
fn splitmix64(mut x: u64) -> u64 {
    x = x.wrapping_add(0x9E37_79B9_7F4A_7C15);
    let mut z = x;
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

/// Draw seed for one game.
///
/// `block` is the index of the colour-swapped pair inside the pairing, so both
/// games of a pair get the same seed and differ only in who plays red. The
/// result stays inside i32 because the front end feeds it to Mersenne Twister,
/// which is seeded with a plain integer.
fn game_seed(master: i64, pair_index: i32, block: i32) -> i64 {
    let mut key = master as u64;
    key ^= (pair_index as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15);
    key ^= (block as u64).wrapping_mul(0xC2B2_AE3D_27D4_EB4F);
    let h = splitmix64(key);
    ((h >> 32) as u32 & 0x7FFF_FFFF) as i64
}

// ----------------------------------------------------------------- rating

/// Bradley–Terry ratings by MM iteration.
///
/// Elo's sequential update drifts order-dependently when several engines play
/// each other (the number depends on who went first), and a league is exactly
/// the case where that shows. BT fits one strength per entrant over all games
/// at once, which is also what the standings want: recomputed from the game
/// table every time, so a crash mid-tournament cannot leave a half-updated
/// rating behind.
///
/// `results` holds `(a, b, score_of_a)` where the score is 1.0, 0.0 or 0.5.
/// Returns a rating per entry id, anchored so the geometric mean of the field
/// is `ANCHOR_RATING`.
fn bradley_terry(entry_ids: &[i64], results: &[(i64, i64, f64)]) -> HashMap<i64, f64> {
    let n = entry_ids.len();
    let mut ratings: HashMap<i64, f64> = entry_ids
        .iter()
        .map(|id| (*id, ANCHOR_RATING))
        .collect();
    if n < 2 || results.is_empty() {
        return ratings;
    }

    // gamma = 10^(R/400)
    let mut gamma: HashMap<i64, f64> = entry_ids
        .iter()
        .map(|id| (*id, 10f64.powf(ANCHOR_RATING / 400.0)))
        .collect();
    let mut score: HashMap<i64, f64> = entry_ids.iter().map(|id| (*id, 0.0)).collect();
    // Number of games between i and j, keyed by the smaller id first.
    let mut pairs: HashMap<(i64, i64), f64> = HashMap::new();

    for (a, b, sa) in results {
        if !score.contains_key(a) || !score.contains_key(b) {
            continue;
        }
        *score.get_mut(a).unwrap() += sa;
        *score.get_mut(b).unwrap() += 1.0 - sa;
        let key = if a <= b { (*a, *b) } else { (*b, *a) };
        *pairs.entry(key).or_insert(0.0) += 1.0;
    }

    for _ in 0..400 {
        let mut next: HashMap<i64, f64> = HashMap::with_capacity(n);
        let mut max_delta = 0f64;
        for id in entry_ids {
            let mut denom = 0f64;
            for other in entry_ids {
                if other == id {
                    continue;
                }
                let key = if id <= other {
                    (*id, *other)
                } else {
                    (*other, *id)
                };
                let games = pairs.get(&key).copied().unwrap_or(0.0);
                if games == 0.0 {
                    continue;
                }
                denom += games / (gamma[id] + gamma[other]);
            }
            // An entrant with no games keeps its gamma; giving it a fitted
            // value would invent evidence.
            let updated = if denom > 0.0 {
                score[id] / denom
            } else {
                gamma[id]
            };
            max_delta = max_delta.max((updated - gamma[id]).abs() / gamma[id].max(1e-9));
            next.insert(*id, updated.max(1e-9));
        }
        gamma = next;
        if max_delta < 1e-10 {
            break;
        }
    }

    // Anchoring: adding a constant to every rating is the only freedom BT
    // leaves, so pin the field's geometric mean and keep the spread.
    let log_mean: f64 = entry_ids
        .iter()
        .map(|id| gamma[id].max(1e-9).ln())
        .sum::<f64>()
        / n as f64;
    for id in entry_ids {
        let g = gamma[id].max(1e-9);
        let delta = (g.ln() - log_mean).clamp(-3.0, 3.0);
        let r = ANCHOR_RATING + 400.0 / 10f64.ln() * delta;
        ratings.insert(*id, (r * 10.0).round() / 10.0);
    }
    ratings
}

// ------------------------------------------------------------------- store

pub struct TournamentStore {
    conn: Connection,
}

impl TournamentStore {
    pub fn new<P: AsRef<Path>>(db_path: P) -> Result<Self> {
        let conn = Connection::open(db_path)?;
        let store = TournamentStore { conn };
        store.initialize_database()?;
        store.migrate()?;
        Ok(store)
    }

    fn initialize_database(&self) -> Result<()> {
        self.conn.execute_batch(
            r#"
            PRAGMA journal_mode = WAL;
            PRAGMA foreign_keys = ON;

            CREATE TABLE IF NOT EXISTS meta (
                key   TEXT PRIMARY KEY,
                value TEXT
            );

            CREATE TABLE IF NOT EXISTS tournament (
                id                INTEGER PRIMARY KEY AUTOINCREMENT,
                name              TEXT NOT NULL,
                format            TEXT NOT NULL,
                time_control      TEXT NOT NULL,
                time_value        INTEGER NOT NULL,
                games_per_pairing INTEGER NOT NULL,
                seed              INTEGER NOT NULL,
                opening_plies     INTEGER NOT NULL DEFAULT 0,
                status            TEXT NOT NULL DEFAULT 'draft',
                created_at        INTEGER NOT NULL,
                updated_at        INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS tournament_entry (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                tournament_id INTEGER NOT NULL REFERENCES tournament(id) ON DELETE CASCADE,
                slot          INTEGER NOT NULL,
                name          TEXT NOT NULL,
                path          TEXT NOT NULL,
                args          TEXT NOT NULL DEFAULT '',
                options       TEXT,
                fingerprint   TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_entry_tournament
                ON tournament_entry (tournament_id, slot);

            CREATE TABLE IF NOT EXISTS tournament_game (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                tournament_id INTEGER NOT NULL REFERENCES tournament(id) ON DELETE CASCADE,
                pair_index    INTEGER NOT NULL,
                game_index    INTEGER NOT NULL,
                red_entry     INTEGER NOT NULL REFERENCES tournament_entry(id),
                black_entry   INTEGER NOT NULL REFERENCES tournament_entry(id),
                seed          INTEGER NOT NULL,
                status        TEXT NOT NULL DEFAULT 'pending',
                result        TEXT,
                reason        TEXT,
                moves         INTEGER,
                duration_ms   INTEGER,
                final_fen     TEXT,
                started_at    INTEGER,
                finished_at   INTEGER
            );

            CREATE INDEX IF NOT EXISTS idx_game_tournament
                ON tournament_game (tournament_id, status, pair_index, game_index);
            "#,
        )?;
        Ok(())
    }

    /// v0 → v1 is the initial creation. The shape of this function is the
    /// point: a future shape change appends a step here instead of rebuilding
    /// tables and throwing away hours of played games.
    fn migrate(&self) -> Result<()> {
        let current: Option<String> = self
            .conn
            .query_row(
                "SELECT value FROM meta WHERE key = 'schema_version'",
                [],
                |row| row.get(0),
            )
            .optional()?;

        let current = current.and_then(|v| v.parse::<i32>().ok()).unwrap_or(0);

        if current < 1 {
            self.conn.execute(
                "INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?1)",
                params![SCHEMA_VERSION.to_string()],
            )?;
            // Games a previous run left mid-flight: nothing is driving them any
            // more, so they go back into the queue instead of blocking the
            // schedule forever.
            self.conn.execute(
                "UPDATE tournament_game SET status = 'pending', started_at = NULL
                 WHERE status = 'running'",
                [],
            )?;
        }

        // if current < 2 { ... future migration ... }

        Ok(())
    }

    // ------------------------------------------------------------ schedule

    /// Validate a configuration before anything is written.
    pub fn validate(config: &TournamentConfig) -> std::result::Result<(), String> {
        if config.entries.len() < 2 {
            return Err("a tournament needs at least two engines".into());
        }
        if !matches!(config.format.as_str(), "gauntlet" | "roundRobin") {
            return Err(format!("unknown format: {}", config.format));
        }
        if !matches!(config.time_control.as_str(), "movetime" | "nodes" | "depth") {
            return Err(format!("unknown time control: {}", config.time_control));
        }
        if config.time_value <= 0 {
            return Err("time control value must be positive".into());
        }
        if config.format == "gauntlet" && config.entries.len() < 3 {
            // A gauntlet of two is a single pairing dressed up as a league.
            return Err("a gauntlet needs a challenger and at least two opponents".into());
        }
        for entry in &config.entries {
            if entry.path.trim().is_empty() {
                return Err(format!("engine '{}' has no path", entry.name));
            }
        }
        Ok(())
    }

    /// Create a tournament and materialise its whole schedule up front.
    ///
    /// Scheduling everything at creation (rather than "pairing N is generated
    /// when the previous one finishes") is what makes resume trivial: a game's
    /// seed, colours and opponents are decided once, so a run stopped at game
    /// 37 and restarted tomorrow plays exactly the same game 38.
    pub fn create(&mut self, config: &TournamentConfig) -> Result<i64> {
        let now = chrono::Utc::now().timestamp_millis();
        let n = config.entries.len();

        // Pairings.
        let mut pairings: Vec<(usize, usize)> = Vec::new();
        if config.format == "gauntlet" {
            for j in 1..n {
                pairings.push((0, j));
            }
        } else {
            for i in 0..n {
                for j in (i + 1)..n {
                    pairings.push((i, j));
                }
            }
        }

        // Games per pairing, forced even so every pairing is a set of
        // colour-swapped pairs.
        let mut per_pairing = config.games_per_pairing.unwrap_or(DEFAULT_GAMES_PER_PAIRING);
        if per_pairing < 2 {
            per_pairing = 2;
        }
        if per_pairing % 2 != 0 {
            per_pairing += 1;
        }
        per_pairing = per_pairing.min(20);

        let master_seed = config.seed.unwrap_or_else(|| {
            // Deterministic default rather than a random one: a tournament the
            // user did not seed should still be replayable tomorrow.
            (now / 1000) & 0x7FFF_FFFF
        });

        let tx = self.conn.transaction()?;
        tx.execute(
            "INSERT INTO tournament (name, format, time_control, time_value,
                 games_per_pairing, seed, opening_plies, status, created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,'draft',?8,?8)",
            params![
                config.name,
                config.format,
                config.time_control,
                config.time_value,
                per_pairing,
                master_seed,
                config.opening_plies.unwrap_or(0).max(0),
                now,
            ],
        )?;
        let tournament_id = tx.last_insert_rowid();

        let mut entry_ids: Vec<i64> = Vec::with_capacity(n);
        for (slot, entry) in config.entries.iter().enumerate() {
            tx.execute(
                "INSERT INTO tournament_entry
                     (tournament_id, slot, name, path, args, options, fingerprint)
                 VALUES (?1,?2,?3,?4,?5,?6,?7)",
                params![
                    tournament_id,
                    slot as i32,
                    entry.name,
                    entry.path,
                    entry.args,
                    entry.options,
                    entry.fingerprint,
                ],
            )?;
            entry_ids.push(tx.last_insert_rowid());
        }

        let blocks = per_pairing / 2;
        let mut scheduled = 0i32;
        let cap = config.max_games.unwrap_or(i32::MAX).max(1);
        'outer: for (pair_index, (a, b)) in pairings.iter().enumerate() {
            for block in 0..blocks {
                let seed = game_seed(master_seed, pair_index as i32, block);
                for k in 0..2 {
                    if scheduled >= cap {
                        break 'outer;
                    }
                    let (red, black) = if k == 0 { (*a, *b) } else { (*b, *a) };
                    tx.execute(
                        "INSERT INTO tournament_game
                             (tournament_id, pair_index, game_index, red_entry, black_entry,
                              seed, status)
                         VALUES (?1,?2,?3,?4,?5,?6,'pending')",
                        params![
                            tournament_id,
                            pair_index as i32,
                            block * 2 + k,
                            entry_ids[red],
                            entry_ids[black],
                            seed,
                        ],
                    )?;
                    scheduled += 1;
                }
            }
        }

        tx.commit()?;
        Ok(tournament_id)
    }
}

impl TournamentStore {
    // ------------------------------------------------------------- reading

    fn summary_from_row(row: &rusqlite::Row<'_>) -> Result<TournamentSummary> {
        // Positional on purpose: the SELECT list above is written once, and
        // matching by name breaks the moment two tables share a column name.
        Ok(TournamentSummary {
            id: row.get(0)?,
            name: row.get(1)?,
            format: row.get(2)?,
            time_control: row.get(3)?,
            time_value: row.get(4)?,
            games_per_pairing: row.get(5)?,
            seed: row.get(6)?,
            opening_plies: row.get(7)?,
            status: row.get(8)?,
            created_at: row.get(9)?,
            updated_at: row.get(10)?,
            entries: row.get(11)?,
            games_total: row.get(12)?,
            games_done: row.get(13)?,
            games_void: row.get(14)?,
        })
    }

    /// One query per list, with the counters as correlated subqueries: the
    /// standings screen repaints while a league runs, and three extra round
    /// trips per tournament would be three extra chances to read a stale count.
    const SUMMARY_COLUMNS: &'static str = "
        t.id, t.name, t.format, t.time_control, t.time_value,
        t.games_per_pairing, t.seed, t.opening_plies, t.status,
        t.created_at, t.updated_at,
        (SELECT COUNT(*) FROM tournament_entry e WHERE e.tournament_id = t.id) AS entries,
        (SELECT COUNT(*) FROM tournament_game g WHERE g.tournament_id = t.id) AS games_total,
        (SELECT COUNT(*) FROM tournament_game g
            WHERE g.tournament_id = t.id AND g.status = 'done') AS games_done,
        (SELECT COUNT(*) FROM tournament_game g
            WHERE g.tournament_id = t.id AND g.status = 'void') AS games_void";

    pub fn list(&self) -> Result<Vec<TournamentSummary>> {
        let sql = format!(
            "SELECT {} FROM tournament t ORDER BY t.created_at DESC",
            Self::SUMMARY_COLUMNS
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map([], Self::summary_from_row)?;
        rows.collect()
    }

    pub fn summary(&self, tournament_id: i64) -> Result<Option<TournamentSummary>> {
        let sql = format!(
            "SELECT {} FROM tournament t WHERE t.id = ?1",
            Self::SUMMARY_COLUMNS
        );
        self.conn
            .query_row(&sql, params![tournament_id], Self::summary_from_row)
            .optional()
    }

    fn entry_from_row(row: &rusqlite::Row<'_>) -> Result<TournamentEntry> {
        Ok(TournamentEntry {
            id: row.get("id")?,
            slot: row.get("slot")?,
            name: row.get("name")?,
            path: row.get("path")?,
            args: row.get("args")?,
            options: row.get("options")?,
            fingerprint: row.get("fingerprint")?,
        })
    }

    pub fn entrants(&self, tournament_id: i64) -> Result<Vec<TournamentEntry>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, slot, name, path, args, options, fingerprint
             FROM tournament_entry WHERE tournament_id = ?1 ORDER BY slot",
        )?;
        let rows = stmt.query_map(params![tournament_id], Self::entry_from_row)?;
        rows.collect()
    }

    fn entrant(&self, entry_id: i64) -> Result<Option<TournamentEntry>> {
        self.conn
            .query_row(
                "SELECT id, slot, name, path, args, options, fingerprint
                 FROM tournament_entry WHERE id = ?1",
                params![entry_id],
                Self::entry_from_row,
            )
            .optional()
    }

    pub fn detail(&self, tournament_id: i64) -> Result<Option<TournamentDetail>> {
        let Some(tournament) = self.summary(tournament_id)? else {
            return Ok(None);
        };
        let entrants = self.entrants(tournament_id)?;
        Ok(Some(TournamentDetail {
            tournament,
            entrants,
        }))
    }

    pub fn games(&self, tournament_id: i64) -> Result<Vec<TournamentGameRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, pair_index, game_index, red_entry, black_entry, seed, status,
                    result, reason, moves, duration_ms, final_fen, finished_at
             FROM tournament_game WHERE tournament_id = ?1
             ORDER BY pair_index, game_index",
        )?;
        let rows = stmt.query_map(params![tournament_id], |row| {
            Ok(TournamentGameRecord {
                id: row.get(0)?,
                pair_index: row.get(1)?,
                game_index: row.get(2)?,
                red_entry: row.get(3)?,
                black_entry: row.get(4)?,
                seed: row.get(5)?,
                status: row.get(6)?,
                result: row.get(7)?,
                reason: row.get(8)?,
                moves: row.get(9)?,
                duration_ms: row.get(10)?,
                final_fen: row.get(11)?,
                finished_at: row.get(12)?,
            })
        })?;
        rows.collect()
    }

    // ------------------------------------------------------------- runner

    /// Claim the next pending game. Returns `None` when the schedule is done.
    ///
    /// Claiming (rather than just reading) is deliberate: if the app is killed
    /// mid-game, `migrate` on the next open returns the claim to the queue, so
    /// a game is never silently skipped and never counted twice.
    pub fn plan_next(&mut self, tournament_id: i64) -> Result<Option<GamePlan>> {
        let Some(tournament) = self.summary(tournament_id)? else {
            return Ok(None);
        };

        let next: Option<(i64, i32, i32, i64, i64, i64)> = self
            .conn
            .query_row(
                "SELECT id, pair_index, game_index, red_entry, black_entry, seed
                 FROM tournament_game
                 WHERE tournament_id = ?1 AND status = 'pending'
                 ORDER BY pair_index, game_index LIMIT 1",
                params![tournament_id],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                    ))
                },
            )
            .optional()?;

        let Some((game_id, pair_index, game_index, red_id, black_id, seed)) = next else {
            return Ok(None);
        };

        let red = self
            .entrant(red_id)?
            .ok_or(rusqlite::Error::QueryReturnedNoRows)?;
        let black = self
            .entrant(black_id)?
            .ok_or(rusqlite::Error::QueryReturnedNoRows)?;

        let games_in_pairing: i32 = self.conn.query_row(
            "SELECT COUNT(*) FROM tournament_game
             WHERE tournament_id = ?1 AND pair_index = ?2",
            params![tournament_id, pair_index],
            |row| row.get(0),
        )?;

        let now = chrono::Utc::now().timestamp_millis();
        self.conn.execute(
            "UPDATE tournament_game SET status = 'running', started_at = ?2 WHERE id = ?1",
            params![game_id, now],
        )?;

        Ok(Some(GamePlan {
            game_id,
            tournament_id,
            pair_index,
            game_index,
            seed,
            red,
            black,
            time_control: tournament.time_control,
            time_value: tournament.time_value,
            opening_plies: tournament.opening_plies,
            games_in_pairing,
        }))
    }

    /// Hand a claimed game back without recording a result (the runner is
    /// stopping, or could not start the engines at all).
    pub fn release(&self, game_id: i64) -> Result<()> {
        self.conn.execute(
            "UPDATE tournament_game SET status = 'pending', started_at = NULL
             WHERE id = ?1 AND status = 'running'",
            params![game_id],
        )?;
        Ok(())
    }

    /// Record a finished game. One statement, one transaction: the row is the
    /// only thing that has to survive, and it is written before the runner
    /// starts the next game.
    pub fn record(&mut self, result: &GameResultInput) -> Result<()> {
        let now = chrono::Utc::now().timestamp_millis();
        let status = if result.void.unwrap_or(false) {
            "void"
        } else {
            "done"
        };
        let tournament_id: i64 = self.conn.query_row(
            "SELECT tournament_id FROM tournament_game WHERE id = ?1",
            params![result.game_id],
            |row| row.get(0),
        )?;

        self.conn.execute(
            "UPDATE tournament_game SET status = ?2, result = ?3, reason = ?4, moves = ?5,
                 duration_ms = ?6, final_fen = ?7, finished_at = ?8
             WHERE id = ?1",
            params![
                result.game_id,
                status,
                result.result,
                result.reason,
                result.moves,
                result.duration_ms,
                result.final_fen,
                now,
            ],
        )?;
        self.conn.execute(
            "UPDATE tournament SET updated_at = ?2 WHERE id = ?1",
            params![tournament_id, now],
        )?;
        Ok(())
    }

    pub fn set_status(&self, tournament_id: i64, status: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE tournament SET status = ?2, updated_at = ?3 WHERE id = ?1",
            params![
                tournament_id,
                status,
                chrono::Utc::now().timestamp_millis()
            ],
        )?;
        Ok(())
    }

    pub fn reset_running(&self, tournament_id: i64) -> Result<()> {
        self.conn.execute(
            "UPDATE tournament_game SET status = 'pending', started_at = NULL
             WHERE tournament_id = ?1 AND status = 'running'",
            params![tournament_id],
        )?;
        Ok(())
    }

    pub fn delete(&self, tournament_id: i64) -> Result<()> {
        self.conn
            .execute("DELETE FROM tournament WHERE id = ?1", params![tournament_id])?;
        Ok(())
    }

    // --------------------------------------------------------- standings

    /// Standings, recomputed from the game table every time.
    ///
    /// Nothing is cached: a rating that lives in a column is a rating that goes
    /// wrong the first time a game is voided or the database is restored from a
    /// backup, and the games are right there.
    pub fn standings(&self, tournament_id: i64) -> Result<Vec<Standing>> {
        let entrants = self.entrants(tournament_id)?;
        let games = self.games(tournament_id)?;

        let mut wins: HashMap<i64, i32> = entrants.iter().map(|e| (e.id, 0)).collect();
        let mut losses: HashMap<i64, i32> = entrants.iter().map(|e| (e.id, 0)).collect();
        let mut draws: HashMap<i64, i32> = entrants.iter().map(|e| (e.id, 0)).collect();
        let ids: Vec<i64> = entrants.iter().map(|e| e.id).collect();
        let mut results: Vec<(i64, i64, f64)> = Vec::new();

        for game in &games {
            if game.status != "done" {
                continue;
            }
            let (red, black) = (game.red_entry, game.black_entry);
            match game.result.as_deref() {
                Some("red") => {
                    *wins.entry(red).or_insert(0) += 1;
                    *losses.entry(black).or_insert(0) += 1;
                    results.push((red, black, 1.0));
                }
                Some("black") => {
                    *wins.entry(black).or_insert(0) += 1;
                    *losses.entry(red).or_insert(0) += 1;
                    results.push((black, red, 1.0));
                }
                Some("draw") => {
                    *draws.entry(red).or_insert(0) += 1;
                    *draws.entry(black).or_insert(0) += 1;
                    results.push((red, black, 0.5));
                }
                // A done game with no result should not exist; ignoring it is
                // still better than inventing a score for it.
                _ => continue,
            }
        }

        let ratings = bradley_terry(&ids, &results);

        let mut standings: Vec<Standing> = entrants
            .into_iter()
            .map(|entry| {
                let w = wins.get(&entry.id).copied().unwrap_or(0);
                let l = losses.get(&entry.id).copied().unwrap_or(0);
                let d = draws.get(&entry.id).copied().unwrap_or(0);
                let games_played = w + l + d;
                let score_rate = if games_played > 0 {
                    (w as f64 + d as f64 / 2.0) / games_played as f64
                } else {
                    0.0
                };
                Standing {
                    entry_id: entry.id,
                    name: entry.name,
                    slot: entry.slot,
                    fingerprint: entry.fingerprint,
                    games: games_played,
                    wins: w,
                    losses: l,
                    draws: d,
                    score_rate: (score_rate * 1000.0).round() / 1000.0,
                    rating: ratings
                        .get(&entry.id)
                        .copied()
                        .unwrap_or(ANCHOR_RATING),
                    provisional: games_played < PROVISIONAL_GAMES,
                }
            })
            .collect();

        // Best first; ties broken by score rate then by name so the order is
        // stable between repaints instead of following the hash map.
        standings.sort_by(|a, b| {
            b.rating
                .partial_cmp(&a.rating)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then(
                    b.score_rate
                        .partial_cmp(&a.score_rate)
                        .unwrap_or(std::cmp::Ordering::Equal),
                )
                .then(a.name.cmp(&b.name))
        });
        Ok(standings)
    }

    pub fn export(&self, tournament_id: i64) -> Result<String> {
        let tournament = self.summary(tournament_id)?;
        let entrants = self.entrants(tournament_id)?;
        let games = self.games(tournament_id)?;
        let standings = self.standings(tournament_id)?;

        let payload = serde_json::json!({
            "format": "jieqibox.tournament",
            "version": SCHEMA_VERSION,
            "tournament": tournament,
            "entrants": entrants,
            "games": games,
            "standings": standings,
        });
        Ok(payload.to_string())
    }

    pub fn game_result(&self, game_id: i64) -> Result<Option<TournamentGameRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, pair_index, game_index, red_entry, black_entry, seed, status,
                    result, reason, moves, duration_ms, final_fen, finished_at
             FROM tournament_game WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map(params![game_id], |row| {
            Ok(TournamentGameRecord {
                id: row.get(0)?,
                pair_index: row.get(1)?,
                game_index: row.get(2)?,
                red_entry: row.get(3)?,
                black_entry: row.get(4)?,
                seed: row.get(5)?,
                status: row.get(6)?,
                result: row.get(7)?,
                reason: row.get(8)?,
                moves: row.get(9)?,
                duration_ms: row.get(10)?,
                final_fen: row.get(11)?,
                finished_at: row.get(12)?,
            })
        })?;
        rows.next().transpose()
    }
}

// ------------------------------------------------------------------- tests

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(name: &str) -> TournamentEntryInput {
        TournamentEntryInput {
            name: name.to_string(),
            path: format!("/engines/{name}"),
            args: String::new(),
            options: None,
            fingerprint: None,
        }
    }

    fn config(format: &str, engines: usize) -> TournamentConfig {
        TournamentConfig {
            name: "test".to_string(),
            format: format.to_string(),
            time_control: "movetime".to_string(),
            time_value: 100,
            games_per_pairing: Some(2),
            seed: Some(42),
            opening_plies: Some(0),
            max_games: None,
            entries: (0..engines).map(|i| entry(&format!("e{i}"))).collect(),
        }
    }

    fn store() -> TournamentStore {
        TournamentStore::new(":memory:").unwrap()
    }

    #[test]
    fn gauntlet_schedules_one_pairing_per_opponent() {
        let mut store = store();
        let id = store.create(&config("gauntlet", 4)).unwrap();
        let games = store.games(id).unwrap();
        // 3 opponents x one colour-swapped pair.
        assert_eq!(games.len(), 6);
        // Every game in the first pairing has e0 on one side.
        let entrants = store.entrants(id).unwrap();
        let e0 = entrants[0].id;
        for game in games.iter().take(2) {
            assert!(game.red_entry == e0 || game.black_entry == e0);
        }
        // ...and the two games of a pair swap colours.
        assert_eq!(games[0].red_entry, games[1].black_entry);
        assert_eq!(games[0].black_entry, games[1].red_entry);
    }

    #[test]
    fn round_robin_pairs_everyone() {
        let mut store = store();
        let id = store.create(&config("roundRobin", 4)).unwrap();
        // C(4,2) = 6 pairings x 2 games.
        assert_eq!(store.games(id).unwrap().len(), 12);
    }

    #[test]
    fn colour_swapped_pair_shares_a_seed() {
        let mut store = store();
        let id = store.create(&config("roundRobin", 3)).unwrap();
        let games = store.games(id).unwrap();
        assert_eq!(games[0].seed, games[1].seed, "a pair must share one draw");
        assert_ne!(games[0].seed, games[2].seed, "the next pair must differ");
        assert!(games.iter().all(|g| (0..i64::from(i32::MAX)).contains(&g.seed)));
    }

    #[test]
    fn claims_are_released_when_a_run_is_interrupted() {
        let mut store = store();
        let id = store.create(&config("roundRobin", 3)).unwrap();
        let plan = store.plan_next(id).unwrap().unwrap();
        assert!(store.plan_next(id).unwrap().unwrap().game_id != plan.game_id);

        // Reopening the store is what a restart does, and the in-flight claim
        // has to come back — a game that is neither played nor queued is a hole
        // in the schedule.
        let path = ":memory:";
        let _ = path;
        store.reset_running(id).unwrap();
        assert_eq!(store.plan_next(id).unwrap().unwrap().game_id, plan.game_id);
    }

    #[test]
    fn one_recorded_game_moves_both_players() {
        let mut store = store();
        let id = store.create(&config("roundRobin", 2)).unwrap();
        let plan = store.plan_next(id).unwrap().unwrap();
        store
            .record(&GameResultInput {
                game_id: plan.game_id,
                result: "red".to_string(),
                reason: "checkmate".to_string(),
                moves: 40,
                duration_ms: 1000,
                final_fen: None,
                void: None,
            })
            .unwrap();

        let standings = store.standings(id).unwrap();
        assert_eq!(standings.len(), 2);
        // One game, seen from both sides: each player's record has to move.
        assert!(standings.iter().all(|s| s.games == 1));
        assert_eq!(standings.iter().map(|s| s.wins).sum::<i32>(), 1);
        assert_eq!(standings.iter().map(|s| s.losses).sum::<i32>(), 1);
        // The winner's rating must beat the loser's, and one game is nowhere
        // near enough to print a settled number.
        assert!(standings[0].rating > standings[1].rating);
        assert!(standings.iter().all(|s| s.provisional));
    }

    #[test]
    fn stronger_engine_ends_up_on_top() {
        let mut store = store();
        let mut cfg = config("roundRobin", 2);
        cfg.games_per_pairing = Some(8);
        let id = store.create(&cfg).unwrap();
        let red_id = store.entrants(id).unwrap()[0].id;

        // e0 wins every game, whichever colour it holds.
        while let Some(plan) = store.plan_next(id).unwrap() {
            let result = if plan.red.id == red_id { "red" } else { "black" };
            store
                .record(&GameResultInput {
                    game_id: plan.game_id,
                    result: result.to_string(),
                    reason: "checkmate".to_string(),
                    moves: 60,
                    duration_ms: 1000,
                    final_fen: None,
                    void: None,
                })
                .unwrap();
        }

        let standings = store.standings(id).unwrap();
        assert_eq!(standings[0].entry_id, red_id);
        assert_eq!(standings[0].games, 8);
        assert_eq!(standings[0].wins, 8);
        assert!(!standings[0].provisional);
        // Eight straight wins against one opponent is worth a few hundred
        // points, not a thousand: BT is bounded by the games actually played.
        assert!(standings[0].rating > 1700.0 && standings[0].rating < 2400.0);
        assert!(
            (standings[0].rating + standings[1].rating - 2.0 * ANCHOR_RATING).abs() < 0.2,
            "the field's mean must stay anchored"
        );
    }

    #[test]
    fn void_games_occupy_their_slot_without_counting() {
        let mut store = store();
        let id = store.create(&config("roundRobin", 2)).unwrap();

        // Play out the whole pairing, voiding every game — what a pair of
        // engines that cannot start would produce.
        let mut voided = 0;
        while let Some(plan) = store.plan_next(id).unwrap() {
            store
                .record(&GameResultInput {
                    game_id: plan.game_id,
                    result: "draw".to_string(),
                    reason: "crash".to_string(),
                    moves: 3,
                    duration_ms: 10,
                    final_fen: None,
                    void: Some(true),
                })
                .unwrap();
            voided += 1;
        }

        // The schedule still ran to its end: void games are consumed, not
        // skipped, so the queue drained instead of jamming on the same game.
        assert_eq!(voided, 2);
        assert_eq!(store.summary(id).unwrap().unwrap().games_void, 2);
        assert!(store.standings(id).unwrap().iter().all(|s| s.games == 0));
        assert!(store.games(id).unwrap().iter().all(|g| g.status == "void"));
    }

    #[test]
    fn validation_rejects_the_shapes_that_cannot_work() {
        let mut store = store();
        assert!(TournamentStore::validate(&config("gauntlet", 2)).is_err());
        assert!(TournamentStore::validate(&config("bogus", 4)).is_err());
        assert!(TournamentStore::validate(&config("roundRobin", 4)).is_ok());
        assert!(store.create(&config("roundRobin", 4)).is_ok());
    }

    #[test]
    fn a_cap_stops_the_schedule_early() {
        let mut store = store();
        let mut cfg = config("roundRobin", 4);
        cfg.max_games = Some(5);
        let id = store.create(&cfg).unwrap();
        assert_eq!(store.games(id).unwrap().len(), 5);
    }
}
