//! One op of every `Op` variant, as the sample save and a scenario each take it: the list
//! the tests of a property of the whole enum run over.
use sgf_core::ops::{LanePair, NewBody, Op, SystemMove};
use sgf_core::projections::galaxy::{PaintSpawnKind, SpawnScript};
use sgf_core::session::Session;
use sgf_core::views::OrbitPlacement;
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
    let mut session = open();
    session
        .apply(Op::AddSystemFromSpec {
            spec: super::spec::dorellion(),
        })
        .expect("add Dorellion");
    session
}

/// The 4.5 sample, which the save examples that need its six-entry flag colours apply to.
pub fn save_4_5() -> Session {
    super::open_4_5()
}

/// The 4.5 sample with [`meissa_v`] added to Meissa as planet [`ADDED_BODY`].
pub fn save_4_5_with_added_body() -> Session {
    let mut session = save_4_5();
    session.apply(meissa_v()).expect("add Meissa V");
    session
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
            name: None,
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
