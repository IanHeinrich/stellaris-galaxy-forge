//! The system the in-game spike added to each sample save, as an `AddSaveSystem` spec: a
//! G star and six planets, the fourth a gas giant with two moons.
use sgf_core::ops::{BeltSpec, BodySpec, SystemSpec};
use sgf_core::session::Session;

/// A sample save the add-system tests run on, with the spike's system for it.
pub struct Sample {
    pub open: fn() -> Session,
    pub spike: fn() -> SystemSpec,
    /// The id a system added to the save as opened takes.
    pub id: u32,
    /// The sample's version, for snapshot names.
    pub label: &'static str,
    /// Two places beside the spike's, clear of every system and of each other, where
    /// more systems fit.
    pub spots: [(f64, f64); 2],
    /// A system the file holds near each spot, for a lane to it.
    pub near: [u32; 2],
    /// A system the file holds further off, for a lane from it to an added one.
    pub joiner: u32,
}

pub const SAMPLES: [Sample; 2] = [
    Sample {
        open: super::open_4_5,
        spike: mura,
        id: 601,
        label: "4_5",
        spots: [(-270.0, -130.0), (-300.0, -120.0)],
        near: [420, 544],
        joiner: 149,
    },
    Sample {
        open: super::open,
        spike: dorellion,
        id: 791,
        label: "4_4",
        spots: [(415.0, -190.0), (420.0, -222.0)],
        near: [217, 278],
        joiner: 614,
    },
];

pub const SAMPLE_4_5: &Sample = &SAMPLES[0];
pub const SAMPLE_4_4: &Sample = &SAMPLES[1];

impl Sample {
    /// The system the file holds that the spike links to.
    pub fn home(&self) -> u32 {
        (self.spike)().lanes[0]
    }
}

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

pub fn with_deposits(mut body: BodySpec, deposits: &[&str]) -> BodySpec {
    body.deposits = deposits.iter().map(|d| (*d).to_owned()).collect();
    body
}

/// A K star with one planet holding a deposit.
pub fn small(name: &str, (x, y): (f64, f64), lanes: Vec<u32>) -> SystemSpec {
    let planet = BodySpec {
        deposits: vec!["d_minerals_3".to_owned()],
        ..body("pc_barren", 10, 60.0, 45.0, 1)
    };
    SystemSpec {
        name: name.to_owned(),
        x,
        y,
        star_class: "sc_k".to_owned(),
        initializer: "basic_init_01".to_owned(),
        star: star(body("pc_k_star", 20, 0.0, 0.0, 0)),
        planets: vec![planet],
        lanes,
        ..SystemSpec::default()
    }
}
