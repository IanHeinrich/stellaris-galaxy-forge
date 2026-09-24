//! The system the in-game spike added to each sample save, as an `AddSaveSystem` spec: a
//! G star and six planets, the fourth a gas giant with two moons.
use sgf_core::ops::{BodySpec, SystemSpec};

/// Spike variant 8 on the 4.5 sample: Mura beside the player's home, linked to it.
pub fn mura() -> SystemSpec {
    spike(
        "Mura",
        (-292.23404, -137.62265),
        169,
        ["d_black_soil", "d_hot_springs", "d_veiny_cliffs"],
    )
}

/// Spike variant 9 on the 4.4 sample: Dorellion beside the player's home, linked to it.
pub fn dorellion() -> SystemSpec {
    spike(
        "Dorellion",
        (433.43269, -205.48736),
        217,
        ["d_rugged_woods", "d_dense_jungle", "d_dense_jungle"],
    )
}

pub fn body(class: &str, size: u32, orbit: f64, angle: f64, entity: u32) -> BodySpec {
    BodySpec {
        class: class.to_owned(),
        size,
        orbit,
        angle,
        entity,
        deposits: Vec::new(),
        moons: Vec::new(),
    }
}

fn with_deposits(mut body: BodySpec, deposits: &[&str]) -> BodySpec {
    body.deposits = deposits.iter().map(|d| (*d).to_owned()).collect();
    body
}

fn spike(name: &str, (x, y): (f64, f64), home: u32, habitable: [&str; 3]) -> SystemSpec {
    let mut giant = with_deposits(body("pc_gas_giant", 25, 145.0, 20.0, 2), &["d_energy_5"]);
    giant.moons = vec![
        body("pc_frozen", 8, 15.0, 60.0, 1),
        body("pc_barren_cold", 6, 22.0, 240.0, 1),
    ];
    SystemSpec {
        name: name.to_owned(),
        x,
        y,
        star_class: "sc_g".to_owned(),
        initializer: "basic_init_01".to_owned(),
        star: with_deposits(body("pc_g_star", 25, 0.0, 0.0, 0), &["d_energy_5"]),
        planets: vec![
            body("pc_molten", 12, 65.0, 30.0, 1),
            body("pc_barren", 14, 85.0, 150.0, 1),
            with_deposits(body("pc_continental", 16, 105.0, 260.0, 2), &habitable),
            giant,
            body("pc_toxic", 15, 175.0, 200.0, 1),
            body("pc_frozen", 13, 205.0, 110.0, 1),
        ],
        lanes: vec![home],
    }
}
