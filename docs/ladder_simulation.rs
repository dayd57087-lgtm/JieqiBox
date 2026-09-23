// Ladder simulation — reference script, NOT part of the build.
//
// `cargo test` proves the code follows the rules; it cannot tell you whether
// the rules produce a sane career. This can: it plays out a season against the
// real store with a known-true player strength and prints the rating curve.
//
// To run it, put `career.rs` in a crate whose only dependencies are rusqlite,
// serde and chrono, drop this in `examples/ladder.rs`, and `cargo run --release
// --example ladder`. See docs/CAREER_M1_STATUS.md for the numbers it produced
// and the design change they forced.

// Ladder simulation.
//
// Not a unit test — an *observation*. The rating system's numbers are easy to
// get subtly wrong in ways no assertion catches (ratings that drift upward
// forever, a ladder whose anchors are unreachable, K-factor cliffs). So we
// play out a season against the real store and look at the curve.
//
// `true_skill` is the player's actual strength; results are drawn from the
// Elo expectation against each opponent, plus a fixed draw rate.

use YOUR_CRATE::{CareerStore, NewGameRequest};

const LADDER: [i32; 12] = [
    800, 950, 1100, 1250, 1400, 1550, 1700, 1850, 2000, 2150, 2350, 2600,
];

struct Rng(u64);

impl Rng {
    fn next_f64(&mut self) -> f64 {
        // xorshift64*
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        let v = x.wrapping_mul(0x2545F4914F6CDD1D);
        (v >> 11) as f64 / (1u64 << 53) as f64
    }
}

fn win_probability(my: f64, opponent: f64) -> f64 {
    1.0 / (1.0 + 10f64.powf((opponent - my) / 400.0))
}

fn play(store: &mut CareerStore, opponent: i32, skill: f64, rng: &mut Rng) -> (String, i32) {
    let p = win_probability(skill, opponent as f64);
    let r = rng.next_f64();
    // 12% of decided games end in a draw, split out of both sides.
    let result = if r < p * 0.88 {
        "win"
    } else if r < p * 0.88 + 0.12 {
        "draw"
    } else {
        "loss"
    };

    let req = NewGameRequest {
        opponent_id: format!("ladder_{opponent}"),
        opponent_rating: opponent,
        human_side: "red".to_string(),
        result: result.to_string(),
        moves: 40,
        duration_ms: 600_000,
        format: None,
        rated: Some(true),
        fen_seed: None,
        initial_fen: "start".to_string(),
        final_fen: None,
        luck_index: None,
        xqf_path: None,
        season_id: None,
        round_no: None,
        moves_detail: None,
        created_at: None,
    };
    let saved = store.save_game(&req).unwrap();
    (result.to_string(), saved.rating_delta)
}

fn season(name: &str, true_skill: f64, games_per_step: usize, max_step: usize) {
    let path = std::env::temp_dir().join(format!("ladder_{name}.db"));
    let _ = std::fs::remove_file(&path);
    let mut store = CareerStore::new(&path).unwrap();
    let mut rng = Rng(0x9E3779B97F4A7C15);

    println!("\n=== {name}: true strength {true_skill} ===");
    println!("step  opp   W-D-L   rating  (first game of the step)");

    for (i, &opponent) in LADDER.iter().enumerate().take(max_step) {
        let before = store.get_profile().unwrap().rating;
        let mut w = 0;
        let mut d = 0;
        let mut l = 0;
        for _ in 0..games_per_step {
            let (result, _) = play(&mut store, opponent, true_skill, &mut rng);
            match result.as_str() {
                "win" => w += 1,
                "draw" => d += 1,
                _ => l += 1,
            }
        }
        let after = store.get_profile().unwrap().rating;
        println!(
            "{:>4}  {:>4}  {}-{}-{}   {:>5} → {:<5}",
            i + 1,
            opponent,
            w,
            d,
            l,
            before,
            after
        );
    }

    let p = store.get_profile().unwrap();
    println!(
        "final: rating {} peak {} record {}-{}-{} ({} games)",
        p.rating, p.peak_rating, p.wins, p.draws, p.losses, p.games_played
    );
}

fn main() {
    // A mid-level player walks the whole ladder twice.
    season("mid_through_ladder", 1600.0, 2, 12);
    // A beginner is expected to plateau early, not to reach the top.
    season("beginner", 1050.0, 3, 12);
    // A strong player should settle near the top and stop climbing.
    season("strong", 2400.0, 3, 12);
    // Farming one weak opponent must not inflate the rating.
    season("farmer", 1600.0, 12, 1);
}
