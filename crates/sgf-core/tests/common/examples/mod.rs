//! One op of every `Op` variant, as the sample save and a scenario each take it: the list
//! the tests of a property of the whole enum run over.
use sgf_core::ops::{
    HabitatPlacement, LanePair, NewBody, NewHabitat, NewMegastructure, NewMegastructurePlace,
    NewPlanet, NewRingWorld, Op, RingQuadrant, RingRow, RingSegment, RingVariable, SystemMove,
    TimedModifier,
};
use sgf_core::projections::galaxy::{PaintSpawnKind, SpawnScript};
use sgf_core::session::Session;
use sgf_core::views::OrbitPlacement;
use std::sync::{LazyLock, Mutex, MutexGuard};
use strum::VariantNames;

use super::fixture::PAINTED;
use super::open;

mod bodies;
mod galaxy;

/// One variant's op for each document kind; `None` where that kind refuses the variant.
pub struct Example {
    pub save: Option<Op>,
    pub scenario: Option<Op>,
    /// Opens the save the save example applies to.
    pub open_save: fn() -> Session,
}

impl Example {
    fn both(op: Op) -> Self {
        Self {
            save: Some(op.clone()),
            scenario: Some(op),
            open_save: save,
        }
    }

    fn each(save_op: Op, scenario: Op) -> Self {
        Self {
            save: Some(save_op),
            scenario: Some(scenario),
            open_save: save,
        }
    }

    fn save(op: Op) -> Self {
        Self {
            save: Some(op),
            scenario: None,
            open_save: save,
        }
    }

    /// A save example only the 4.5 sample takes.
    fn save_4_5(op: Op) -> Self {
        Self {
            save: Some(op),
            scenario: None,
            open_save: save_4_5,
        }
    }

    /// A save example that needs a body added to the 4.5 sample in the session.
    fn added_body(op: Op) -> Self {
        Self {
            save: Some(op),
            scenario: None,
            open_save: save_4_5_with_added_body,
        }
    }

    /// A save example that needs a ring world added to the 4.5 sample in the session.
    fn added_ring_world(op: Op) -> Self {
        Self {
            save: Some(op),
            scenario: None,
            open_save: save_4_5_with_added_ring_world,
        }
    }

    /// A save example that needs a megastructure added to the 4.5 sample in the session.
    fn added_megastructure(op: Op) -> Self {
        Self {
            save: Some(op),
            scenario: None,
            open_save: save_4_5_with_added_megastructure,
        }
    }

    /// A save example that needs a system added in the session, with its scenario twin.
    fn each_added(save_op: Op, scenario: Op) -> Self {
        Self {
            save: Some(save_op),
            scenario: Some(scenario),
            open_save: save_with_added,
        }
    }

    /// A save example that needs a system added in the session; a scenario refuses it.
    fn added(op: Op) -> Self {
        Self {
            save: Some(op),
            scenario: None,
            open_save: save_with_added,
        }
    }

    fn scenario(op: Op) -> Self {
        Self {
            save: None,
            scenario: Some(op),
            open_save: save,
        }
    }

    /// The example's op for either kind, the same variant whichever it is.
    pub fn op(&self) -> &Op {
        self.save
            .as_ref()
            .or(self.scenario.as_ref())
            .expect("an op for one kind")
    }

    pub fn name(&self) -> &'static str {
        self.op().name()
    }
}

/// The sample save, which every save example applies to.
pub fn save() -> Session {
    open()
}

/// The sample save with Dorellion added as system 791, which only the removal of a system
/// added in the session needs.
pub fn save_with_added() -> Session {
    static ADDED: LazyLock<Mutex<Session>> = LazyLock::new(|| {
        let mut session = open();
        session
            .apply(Op::AddSystemFromSpec {
                spec: super::spec::dorellion(),
            })
            .expect("add Dorellion");
        Mutex::new(session)
    });
    held(&ADDED).clone()
}

/// What `cell` holds, which each binary builds once.
fn held<T>(cell: &'static LazyLock<Mutex<T>>) -> MutexGuard<'static, T> {
    cell.lock().unwrap_or_else(|held| held.into_inner())
}

/// The 4.5 sample, which the save examples that need its six-entry flag colours apply to.
pub fn save_4_5() -> Session {
    super::open_4_5()
}

/// The 4.5 sample with [`meissa_v`] added to Meissa as planet [`ADDED_BODY`].
pub fn save_4_5_with_added_body() -> Session {
    static ADDED: LazyLock<Mutex<Session>> = LazyLock::new(|| {
        let mut session = save_4_5();
        session.apply(meissa_v()).expect("add Meissa V");
        Mutex::new(session)
    });
    held(&ADDED).clone()
}

/// The 4.5 sample with [`sol_nexus`] added as row [`ADDED_MEGASTRUCTURE`].
pub fn save_4_5_with_added_megastructure() -> Session {
    static ADDED: LazyLock<Mutex<Session>> = LazyLock::new(|| {
        let mut session = save_4_5();
        session.apply(sol_nexus()).expect("add the Science Nexus");
        Mutex::new(session)
    });
    held(&ADDED).clone()
}

/// The id the 4.5 sample's first added megastructure takes: the slot past its highest, 15.
pub const ADDED_MEGASTRUCTURE: u32 = 16;

/// A Science Nexus on gas giant 6 of the 4.5 sample's capital system, Alari (169), owned
/// by country 0, which marks its planet as the game's build does.
pub fn sol_nexus() -> Op {
    Op::AddMegastructure {
        system: 169,
        spec: NewMegastructure {
            kind: "think_tank_3".to_owned(),
            at: NewMegastructurePlace::Body {
                body: 6,
                body_flags: vec!["has_megastructure".to_owned()],
                star_only: false,
            },
            owner: Some(0),
            ..NewMegastructure::default()
        },
    }
}

/// A habitat round barren planet 4 of the 4.5 sample's capital system, Alari (169), as the
/// install's Habitat Central Complex makes one round a planet.
pub fn sol_habitat() -> Op {
    Op::AddHabitat {
        body: 4,
        habitat: NewHabitat {
            planet: NewPlanet {
                class: "pc_habitat".to_owned(),
                size: 6,
                at: OrbitPlacement {
                    radius: 9.899,
                    angle: 315.0,
                },
                name: "HABITAT_PLANET_NAME".to_owned(),
                model: Some("mammalian_01_habitat_phase_03_entity".to_owned()),
                flags: ["megastructure", "habitat", "habitat_level_1"]
                    .map(str::to_owned)
                    .to_vec(),
            },
            system_name: Some("prev.solar_system.GetName".to_owned()),
            orbital: None,
            placed: HabitatPlacement::AtAngle,
        },
    }
}

/// The 4.5 sample's Habraq: star 778, four planets, moon 783 of 782 and one belt, owned.
pub const HABRAQ: u32 = 159;
/// The 4.5 sample's Chors Compass: star 794, four planets and two belts, owned.
pub const CHORS_COMPASS: u32 = 23;

/// The save angles of the vanilla ring world's quadrants, A to D.
pub const QUADRANT_ANGLES: [f64; 4] = [180.0, 270.0, 0.0, 90.0];

fn segment(
    class: &str,
    angle: f64,
    name: &str,
    model: Option<&str>,
    flags: &[&str],
) -> RingSegment {
    RingSegment {
        planet: NewPlanet {
            class: class.to_owned(),
            size: 10,
            at: OrbitPlacement {
                radius: 45.0,
                angle: (angle + 360.0) % 360.0,
            },
            name: name.to_owned(),
            model: model.map(|stem| format!("mammalian_01_{stem}")),
            flags: flags.iter().map(|f| (*f).to_owned()).collect(),
        },
        megastructure_icon: class == "pc_ringworld_habitable",
        modifiers: Vec::new(),
    }
}

/// A finished quadrant of the vanilla ring world at save angle `at`, as the install lays it
/// out in the culture `mammalian_01`: tech 30 degrees on, the seam on the row's point and the
/// habitable section, named `habitable`, 30 degrees back.
pub fn finished_quadrant(at: f64, habitable: &str) -> RingQuadrant {
    RingQuadrant::Finished {
        segments: vec![
            segment(
                "pc_ringworld_tech",
                at + 30.0,
                "NAME_Ring_Section",
                Some("ringworld_tech_entity_01_entity"),
                &["megastructure"],
            ),
            segment(
                "pc_ringworld_seam",
                at,
                "NAME_Ring_Section",
                Some("ringworld_seam_entity_01_entity"),
                &["megastructure"],
            ),
            segment(
                "pc_ringworld_habitable",
                at - 30.0,
                habitable,
                Some("ringworld_habitable_entity_01_entity"),
                &["megastructure"],
            ),
        ],
    }
}

/// A damaged quadrant at save angle `at`: the damaged classes with no model or flag.
pub fn damaged_quadrant(at: f64) -> RingQuadrant {
    let mut segments = vec![
        segment(
            "pc_ringworld_tech_damaged",
            at + 30.0,
            "NAME_Ring_Section",
            None,
            &[],
        ),
        segment(
            "pc_ringworld_seam_damaged",
            at,
            "NAME_Ring_Section",
            None,
            &[],
        ),
        segment(
            "pc_ringworld_habitable_damaged",
            at - 30.0,
            "NAME_Ring_Section",
            None,
            &[],
        ),
    ];
    for segment in &mut segments {
        segment.megastructure_icon = false;
    }
    RingQuadrant::Damaged { segments }
}

fn ring_row(kind: &str, at: f64, name: Option<&str>, culture: Option<&str>) -> RingRow {
    RingRow {
        kind: kind.to_owned(),
        at: OrbitPlacement {
            radius: 45.0,
            angle: at,
        },
        name: name.map(str::to_owned),
        owned: true,
        culture: culture.map(str::to_owned),
    }
}

/// The vanilla ring world with every quadrant finished, flagging its star as Gigastructural
/// Engineering's does.
pub fn finished_ring() -> NewRingWorld {
    NewRingWorld {
        quadrants: QUADRANT_ANGLES
            .iter()
            .zip(["A", "B", "C", "D"])
            .map(|(&at, q)| finished_quadrant(at, &format!("NAME_Habitable_Section_{q}")))
            .collect(),
        system_flags: vec!["ring_world_built".to_owned()],
        system_variables: Vec::new(),
        star_flags: vec!["has_megastructure".to_owned()],
    }
}

/// The radius Gigastructural Engineering spawns its titanic ring world at.
pub const TITANIC_RADIUS: f64 = 90.0;

/// A finished quadrant of Gigastructural Engineering's titanic ring world at save angle `at`,
/// as the install lays it out in the culture `mammalian_01`: the habitable section, named
/// `habitable`, is of size 20 and has the housing modifier with no end.
fn titanic_quadrant(at: f64, habitable: &str) -> RingQuadrant {
    let part = |class: &str, angle: f64, name: &str, model: &str, flags: &[&str]| RingSegment {
        planet: NewPlanet {
            class: class.to_owned(),
            size: 10,
            at: OrbitPlacement {
                radius: TITANIC_RADIUS,
                angle: (angle + 360.0) % 360.0,
            },
            name: name.to_owned(),
            model: Some(format!("mammalian_01_titanic_{model}_sector_entity")),
            flags: flags.iter().map(|f| (*f).to_owned()).collect(),
        },
        megastructure_icon: false,
        modifiers: Vec::new(),
    };
    let mut habitable = part(
        "pc_ringworld_habitable",
        at - 30.0,
        habitable,
        "gaia_habitable",
        &[
            "forbid_guillis_planet_modifiers",
            "megastructure",
            "colony_event",
            "giga_ringworld_tit",
        ],
    );
    habitable.planet.size = 20;
    habitable.megastructure_icon = true;
    habitable.modifiers = vec![TimedModifier {
        modifier: "giga_titanic_housing".to_owned(),
        days: None,
    }];
    RingQuadrant::Finished {
        segments: vec![
            part(
                "pc_ringworld_tech",
                at + 30.0,
                "Ring Section",
                "tech",
                &[
                    "forbid_guillis_planet_modifiers",
                    "megastructure",
                    "colony_event",
                    "giga_ringworld_tit",
                ],
            ),
            part(
                "pc_ringworld_seam",
                at,
                "Ring Section",
                "seam",
                &["forbid_guillis_planet_modifiers", "megastructure"],
            ),
            habitable,
        ],
    }
}

/// Gigastructural Engineering's titanic ring world with every quadrant finished, beside a
/// ring whose habitable sections took `ring_01` to `ring_04`: its own are E to H.
pub fn titanic_ring() -> NewRingWorld {
    NewRingWorld {
        quadrants: QUADRANT_ANGLES
            .iter()
            .zip(["E", "F", "G", "H"])
            .map(|(&at, q)| titanic_quadrant(at, &format!("Habitable Section {q}")))
            .collect(),
        system_flags: [
            "giga_has_titanic_ring",
            "ring_05",
            "ring_06",
            "ring_07",
            "ring_world_built_one",
            "ring_08",
        ]
        .map(str::to_owned)
        .to_vec(),
        system_variables: vec![RingVariable {
            name: "t_ring_segments".to_owned(),
            value: 0.0,
        }],
        star_flags: vec!["has_megastructure".to_owned()],
    }
}

/// The vanilla ring world with A finished, B a frame, C ruined and D damaged.
pub fn mixed_ring() -> NewRingWorld {
    NewRingWorld {
        quadrants: vec![
            finished_quadrant(180.0, "NAME_Habitable_Section_A"),
            RingQuadrant::Frame {
                row: ring_row(
                    "ring_world_2",
                    270.0,
                    Some("NAME_Ring_Section_B"),
                    Some("mammalian_01"),
                ),
            },
            RingQuadrant::Ruined {
                row: ring_row("ring_world_ruined", 0.0, None, None),
            },
            damaged_quadrant(90.0),
        ],
        system_flags: ["ring_world_built", "ring_section_1"]
            .map(str::to_owned)
            .to_vec(),
        system_variables: Vec::new(),
        star_flags: Vec::new(),
    }
}

/// The mixed ring round Chors Compass's star, owned by `owner`, with its planets left where
/// they are.
pub fn chors_ring(owner: Option<u32>) -> Op {
    Op::AddRingWorld {
        system: CHORS_COMPASS,
        owner,
        ring: mixed_ring(),
    }
}

/// The 4.5 sample with [`chors_ring`] added for country 0, and the op that takes it out,
/// built once per binary.
static ADDED_RING_WORLD: LazyLock<Mutex<(Session, Op)>> = LazyLock::new(|| {
    let mut session = save_4_5();
    let removal = session
        .apply(chors_ring(Some(0)))
        .expect("add the ring world")
        .inverse;
    Mutex::new((session, removal))
});

/// The 4.5 sample with [`chors_ring`] added for country 0.
pub fn save_4_5_with_added_ring_world() -> Session {
    held(&ADDED_RING_WORLD).0.clone()
}

/// The inverse of [`chors_ring`] for country 0 on the 4.5 sample.
pub fn chors_ring_removal() -> Op {
    held(&ADDED_RING_WORLD).1.clone()
}

/// The id the 4.5 sample's first added planet takes: dead slot 57, one generation on.
pub const ADDED_BODY: u32 = 57 | 1 << 24;

/// A barren planet added to the 4.5 sample's Meissa (408), which nobody owns.
pub fn meissa_v() -> Op {
    Op::AddBody {
        system: 408,
        spec: NewBody {
            class: "pc_barren".to_owned(),
            size: 10,
            moon_of: None,
            deposits: vec!["d_minerals_2".to_owned()],
            ..NewBody::default()
        },
        at: OrbitPlacement {
            radius: 45.0,
            angle: 300.0,
        },
    }
}

/// The painted fixture with a `prevent_hyperlane` added, which every scenario example
/// applies to: it holds every statement some scenario op writes.
pub fn scenario() -> Session {
    let lane = "\tadd_hyperlane = { from = \"4\" to = \"13\" }\n";
    PAINTED.open_edited(&[(
        lane,
        &format!("{lane}\tprevent_hyperlane = {{ from = \"10\" to = \"12\" }}\n"),
    )])
}

/// Every variant once, in declaration order. Fails when a variant has no example.
pub fn one_of_each() -> Vec<Example> {
    let mut examples = galaxy::examples();
    examples.extend(bodies::examples());
    for example in &examples {
        for op in [&example.save, &example.scenario].into_iter().flatten() {
            assert_eq!(op.name(), example.name(), "one variant per example");
        }
    }
    let names: Vec<&str> = examples.iter().map(Example::name).collect();
    assert_eq!(
        names,
        Op::VARIANTS,
        "one example of each variant, in declaration order"
    );
    examples
}

fn moved(id: u32, x: f64, y: f64) -> SystemMove {
    SystemMove { system: id, x, y }
}

fn pair(a: u32, b: u32, bridge: bool) -> LanePair {
    LanePair { a, b, bridge }
}

fn seat(random_value: u8) -> Option<SpawnScript> {
    Some(SpawnScript::PaintAGalaxy {
        kind: PaintSpawnKind::Enabled,
        random_value,
        player: false,
    })
}
