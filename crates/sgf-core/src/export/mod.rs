//! Writing a static galaxy scenario from a galaxy, and the three ways to reach one:
//! export a save's galaxy to a file, start an empty scenario, or open a save as an
//! unsaved scenario. The save itself is never rewritten (ADR 0004, decision 4).
//!
//! One generator serves all three, so a file written here reads back through
//! `Document::from_scenario_bytes` into the same systems, positions and lanes. The
//! galaxy is first drafted, statement by statement, then rendered; a profile decorates
//! the draft in between, so the plain output never depends on one.

mod paint;

use std::collections::BTreeSet;
use std::path::Path;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::archive;
use crate::as_u32;
use crate::document::{self, Document, SaveOutcome};
use crate::format::scenario::emit::{
    FOOTER, ScenarioOptions, header, hyperlane_stmt, nebula_stmt, system_stmt,
};
pub use crate::format::scenario::emit::{SpawnStmt as SpawnDraft, SystemStmt as SystemDraft};
use crate::format::scenario::index::{self as scenario, SCENARIO_X_SIGN, SCENARIO_Y_SIGN};
use crate::keys::scenario as keys;
use crate::ops::rules::check_name;
use crate::projections::galaxy::{Galaxy, GalaxyGraph, ProjectionError};
use crate::projections::name::NameTemplate;
use crate::search::NameResolver;
use crate::session::{Session, SessionError};
use crate::views::DocumentKind;

/// Every statement of a generated scenario sits one tab inside the block.
const INDENT: &[u8] = b"\t";

/// Empire spawn points a galaxy is sized for: one per this many systems, clamped to
/// [`MIN_EMPIRES`]..=[`MAX_EMPIRES`].
const SYSTEMS_PER_EMPIRE: usize = 60;
const MIN_EMPIRES: u32 = 1;
const MAX_EMPIRES: u32 = 30;

/// Whose conventions a written scenario follows. `Plain` is the game's alone; the
/// other writes what a companion mod reads on top of it, and the map then needs
/// that mod.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum ScenarioProfile {
    #[default]
    Plain,
    /// Spawn points in Paint a Galaxy's scripted shape and a header sized for its
    /// mod's fixes (Steam Workshop 3532904115).
    PaintAGalaxy,
}

/// A scenario file before it is text: the header, one entry per system in file
/// order, each undirected lane once and each nebula.
#[derive(Debug, Clone, PartialEq)]
pub struct Draft {
    pub header: Vec<u8>,
    pub systems: Vec<SystemDraft>,
    pub lanes: Vec<(u32, u32)>,
    pub nebulae: Vec<NebulaDraft>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct NebulaDraft {
    pub name: String,
    pub x: f64,
    pub y: f64,
    pub radius: f64,
}

/// A whole scenario file: the header, one `system` statement per system in file order,
/// one `add_hyperlane` per undirected lane and one `nebula` per cloud.
pub fn scenario_text(
    graph: &GalaxyGraph,
    options: &ScenarioOptions,
    resolve: NameResolver<'_>,
    profile: ScenarioProfile,
) -> Vec<u8> {
    let mut draft = draft(graph, options, resolve);
    if profile == ScenarioProfile::PaintAGalaxy {
        paint::decorate(&mut draft, options, graph, &graph.countries);
    }
    render(&draft)
}

/// The galaxy as the plain profile writes it. A lane to itself or to a system the
/// galaxy does not hold is skipped, since the game would refuse it.
pub fn draft(galaxy: &Galaxy, options: &ScenarioOptions, resolve: NameResolver<'_>) -> Draft {
    let systems = galaxy
        .order
        .iter()
        .filter_map(|id| galaxy.systems.get(id))
        .map(|system| SystemDraft {
            id: system.id,
            name: name_of(&system.name, resolve),
            x: system.x * SCENARIO_X_SIGN,
            y: system.y * SCENARIO_Y_SIGN,
            initializer: Some(system.initializer.clone()).filter(|i| !i.is_empty()),
            spawn: SpawnDraft::None,
            effect: None,
        })
        .collect();
    let nebulae = galaxy
        .nebulae
        .iter()
        .map(|nebula| NebulaDraft {
            name: name_of(&nebula.name, resolve),
            x: nebula.x * SCENARIO_X_SIGN,
            y: nebula.y * SCENARIO_Y_SIGN,
            radius: nebula.radius,
        })
        .collect();
    Draft {
        header: header(options),
        systems,
        lanes: lane_pairs(galaxy),
        nebulae,
    }
}

/// The draft as file text.
pub fn render(draft: &Draft) -> Vec<u8> {
    let mut out = draft.header.clone();
    for system in &draft.systems {
        out.extend(system_stmt(INDENT, system));
    }
    out.push(b'\n');
    for &(a, b) in &draft.lanes {
        out.extend(hyperlane_stmt(INDENT, a, b));
    }
    out.push(b'\n');
    for nebula in &draft.nebulae {
        out.extend(nebula_stmt(
            INDENT,
            &nebula.name,
            nebula.x,
            nebula.y,
            nebula.radius,
        ));
    }
    out.extend_from_slice(FOOTER);
    out
}

/// The header `galaxy` is exported under: its own core radius, and empire slots sized
/// from its systems (see [`SYSTEMS_PER_EMPIRE`]).
pub fn options_for(galaxy: &Galaxy, name: &str) -> ScenarioOptions {
    ScenarioOptions {
        name: quotable(name),
        core_radius: galaxy.core_radius,
        num_empires: (0, empire_slots(galaxy.systems.len())),
    }
}

/// Write scenario text to `path` under the save path's backup rule: a temp file beside
/// the target, the file already there renamed to `<file>.bak-YYYYmmdd-HHMMSS`.
pub fn write_scenario(path: &Path, text: &[u8]) -> Result<SaveOutcome, document::Error> {
    let backup = archive::write_text_with(path, std::iter::once(text), |_| {})?;
    Ok(SaveOutcome {
        path: path.to_path_buf(),
        backup,
    })
}

/// A scenario with no systems, never saved: the header and its closing brace.
pub fn new_scenario(
    name: &str,
    core_radius: f64,
    profile: ScenarioProfile,
) -> Result<Session, SessionError> {
    check_name(name)
        .map_err(|_| document::Error::Scenario(scenario::Error::InvalidName(name.to_owned())))?;
    let options = ScenarioOptions {
        name: name.to_owned(),
        core_radius,
        num_empires: (0, MIN_EMPIRES),
    };
    let mut text = match profile {
        ScenarioProfile::Plain => header(&options),
        ScenarioProfile::PaintAGalaxy => paint::header(&options, 0, 0),
    };
    text.extend_from_slice(FOOTER);
    Session::from_document(None, Document::from_scenario_bytes(text)?)
}

/// Open a save's galaxy as a new, unsaved scenario named after the save's file stem.
/// The save is only read.
pub fn open_save_as_scenario(
    path: &Path,
    resolve: NameResolver<'_>,
    profile: ScenarioProfile,
) -> Result<Session, SessionError> {
    let save = Session::open(path)?;
    if save.kind() != DocumentKind::Save {
        return Err(SessionError::Projection(ProjectionError::SectionField {
            section: keys::STATIC_GALAXY_SCENARIO,
            reason: format!(
                "{} is already a scenario; open it directly instead",
                path.display()
            ),
        }));
    }
    let name = path
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
    let text = scenario_text(
        &save.graph,
        &options_for(&save.graph, &name),
        resolve,
        profile,
    );
    Session::from_document(None, Document::from_scenario_bytes(text)?)
}

/// Open scenario text received from elsewhere (e.g. Paint a Galaxy) as a new, unsaved
/// scenario; the title comes from the text's own `name` header field.
pub fn open_scenario_text(text: Vec<u8>) -> Result<Session, SessionError> {
    Session::from_document(None, Document::from_scenario_bytes(text)?)
}

/// Every undirected lane once, lower id first, ascending.
fn lane_pairs(galaxy: &Galaxy) -> Vec<(u32, u32)> {
    let mut pairs = BTreeSet::new();
    for system in galaxy.order.iter().filter_map(|id| galaxy.systems.get(id)) {
        for lane in &system.lanes {
            if lane.to != system.id && galaxy.systems.contains_key(&lane.to) {
                pairs.insert((system.id.min(lane.to), system.id.max(lane.to)));
            }
        }
    }
    pairs.into_iter().collect()
}

/// The localised name when the resolver knows the key, else the no-game-data stand-in,
/// which keeps a key a key so the game can still look it up.
fn name_of(name: &NameTemplate, resolve: NameResolver<'_>) -> String {
    let text = match resolve(&name.key) {
        Some(text) if !name.literal => text,
        _ => name.stand_in(),
    };
    quotable(&text)
}

/// `text` as it can stand between quotes, which cannot escape: a quote, backslash
/// or line break is dropped.
fn quotable(text: &str) -> String {
    text.chars()
        .filter(|c| !matches!(c, '"' | '\\' | '\n' | '\r'))
        .collect()
}

fn empire_slots(systems: usize) -> u32 {
    as_u32(systems / SYSTEMS_PER_EMPIRE).clamp(MIN_EMPIRES, MAX_EMPIRES)
}
