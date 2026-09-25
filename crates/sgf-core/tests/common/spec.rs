//! The system the in-game spike added to each sample save, as an `AddSaveSystem` spec: a
//! G star and six planets, the fourth a gas giant with two moons.
use sgf_core::ops::{BeltSpec, BodySpec, SystemSpec};

/// Spike variant 8 on the 4.5 sample: Mura beside the player's home, linked to it.
pub fn mura() -> SystemSpec {
    serde_json::from_str(include_str!("../../../../testdata/mura.json")).expect("mura.json")
}

/// Spike variant 9 on the 4.4 sample: Dorellion beside the player's home, linked to it.
pub fn dorellion() -> SystemSpec {
    serde_json::from_str(include_str!("../../../../testdata/dorellion.json"))
        .expect("dorellion.json")
}

/// The spike's system with `basic_init_05`'s two belts, the rocky one moved in from 130
/// to 95: two asteroids on it between the second and third planets, and two on the icy
/// belt at 240 past the last.
pub fn belted(mut spec: SystemSpec) -> SystemSpec {
    let asteroid = |class: &str, orbit: f64, angle: f64| BodySpec {
        asteroid: true,
        ..body(class, 5, orbit, angle, 0)
    };
    spec.initializer = "basic_init_05".to_owned();
    spec.planets.splice(
        2..2,
        [
            asteroid("pc_asteroid", 95.0, 100.0),
            asteroid("pc_asteroid", 95.0, 190.0),
        ],
    );
    spec.planets.extend([
        asteroid("pc_ice_asteroid", 240.0, 80.0),
        asteroid("pc_ice_asteroid", 240.0, 170.0),
    ]);
    spec.belts = vec![
        BeltSpec {
            kind: "rocky_asteroid_belt".to_owned(),
            inner_radius: 95.0,
        },
        BeltSpec {
            kind: "icy_asteroid_belt".to_owned(),
            inner_radius: 240.0,
        },
    ];
    spec
}

/// The spike's system rolled again from `basic_init_03`: an M star with three planets,
/// the last holding a deposit.
pub fn rerolled(mut spec: SystemSpec) -> SystemSpec {
    spec.initializer = "basic_init_03".to_owned();
    spec.star_class = "sc_m".to_owned();
    spec.star = star(body("pc_m_star", 18, 0.0, 0.0, 0));
    spec.planets = vec![
        body("pc_barren", 10, 55.0, 40.0, 1),
        body("pc_desert", 17, 90.0, 200.0, 2),
        with_deposits(body("pc_gas_giant", 22, 130.0, 300.0, 2), &["d_minerals_4"]),
    ];
    spec
}

pub fn body(class: &str, size: u32, orbit: f64, angle: f64, entity: u32) -> BodySpec {
    BodySpec {
        class: class.to_owned(),
        size,
        orbit,
        angle,
        entity,
        ..BodySpec::default()
    }
}

/// `body` as the generator marks a body of a star class.
pub fn star(body: BodySpec) -> BodySpec {
    BodySpec { star: true, ..body }
}

fn with_deposits(mut body: BodySpec, deposits: &[&str]) -> BodySpec {
    body.deposits = deposits.iter().map(|d| (*d).to_owned()).collect();
    body
}
