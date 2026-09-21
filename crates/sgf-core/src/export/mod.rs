//! Writing a static galaxy scenario from a galaxy, and the three ways to reach one:
//! export a save's galaxy to a file, start an empty scenario, or open a save as an
//! unsaved scenario. The save itself is never rewritten (ADR 0004, decision 4).
//!
//! One generator serves all three, so a file written here reads back through
//! `Document::from_scenario_bytes` into the same systems, positions and lanes. The
//! galaxy is first drafted, statement by statement, then rendered; a profile decorates
//! the draft in between, so the plain output never depends on one. Drafting also
//! reports what the file could not carry over (`report`), which a save's export writes
//! as comment lines above the header once the profile has had its say.

mod paint;
pub mod policy;
mod report;

use std::collections::BTreeSet;
use std::path::Path;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::archive;
use crate::as_u32;
use crate::document::{self, Document, SaveOutcome};
use crate::format::scenario::emit::{FOOTER, header, hyperlane_stmt, nebula_stmt, system_stmt};
pub use crate::format::scenario::emit::{
    ScenarioOptions, SpawnStmt as SpawnDraft, SystemStmt as SystemDraft,
};
use crate::format::scenario::header_counts::SeatCounts;
use crate::format::scenario::index::{self as scenario, SCENARIO_X_SIGN, SCENARIO_Y_SIGN};
use crate::keys::scenario as keys;
use crate::ops::rules::check_name;
use crate::projections::galaxy::{Galaxy, GalaxyGraph, ProjectionError};
use crate::projections::name::NameTemplate;
use crate::search::NameResolver;
use crate::session::{Session, SessionError};
use crate::views::DocumentKind;
use policy::Category;
pub use report::{
    CategoryCount, DroppedBypasses, ExportReport, FallenEmpireReport, HomeInitializer,
    OmittedCount, SourceCount,
};

/// Where an initializer comes from, for the "needs" line: a DLC's or a mod's name,
/// `None` when it is vanilla or unknown.
pub type SourceResolver<'a> = &'a dyn Fn(&str) -> Option<String>;

/// Every statement of a generated scenario sits one tab inside the block.
const INDENT: &[u8] = b"\t";
/// The weight every empire seat is written with.
const SEAT_WEIGHT: f64 = 1.0;

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

/// A whole scenario file: the comment lines a save's export opens with, the header, one
/// `system` statement per system in file order, one `add_hyperlane` per undirected lane
/// and one `nebula` per cloud, with the report of what the file could not carry over.
pub fn scenario_text(
    graph: &GalaxyGraph,
    options: &ScenarioOptions,
    resolve: NameResolver<'_>,
    sources: SourceResolver<'_>,
    profile: ScenarioProfile,
) -> (Vec<u8>, ExportReport) {
    let (mut draft, mut report) = draft(graph, options, resolve, sources);
    if profile == ScenarioProfile::PaintAGalaxy {
        paint::decorate(&mut draft, &mut report, options, graph, resolve);
    }
    let mut text = match &options.exported_from {
        Some(save) => comment_block(save, &draft, &report).into_bytes(),
        None => Vec::new(),
    };
    text.extend(render(&draft));
    (text, report)
}

/// The galaxy as the plain profile writes it: an empire seat on every home system,
/// everything else as the save holds it but the L-Cluster, which the game adds by
/// itself. A lane to itself or to a system the draft does not hold is skipped, since
/// the game would refuse it.
pub fn draft(
    graph: &GalaxyGraph,
    options: &ScenarioOptions,
    resolve: NameResolver<'_>,
    sources: SourceResolver<'_>,
) -> (Draft, ExportReport) {
    let galaxy: &Galaxy = graph;
    let categories = report::categories(graph);
    let mut report = report::build(graph, &categories, sources);
    let omitted: BTreeSet<u32> = categories
        .iter()
        .filter(|(_, category)| **category == Category::LCluster)
        .map(|(id, _)| *id)
        .collect();
    if !omitted.is_empty() {
        report.omitted.push(OmittedCount {
            category: Category::LCluster,
            systems: as_u32(omitted.len()),
        });
    }
    let systems: Vec<SystemDraft> = galaxy
        .order
        .iter()
        .filter(|id| !omitted.contains(id))
        .filter_map(|id| galaxy.systems.get(id))
        .map(|system| SystemDraft {
            id: system.id,
            name: name_of(&system.name, resolve),
            x: system.x * SCENARIO_X_SIGN,
            y: system.y * SCENARIO_Y_SIGN,
            initializer: Some(system.initializer.clone()).filter(|i| !i.is_empty()),
            spawn: match categories.get(&system.id) {
                Some(Category::Home) => SpawnDraft::Base(SEAT_WEIGHT),
                _ => SpawnDraft::None,
            },
            effect: None,
        })
        .collect();
    let nebulae: Vec<NebulaDraft> = galaxy
        .nebulae
        .iter()
        .map(|nebula| NebulaDraft {
            name: name_of(&nebula.name, resolve),
            x: nebula.x * SCENARIO_X_SIGN,
            y: nebula.y * SCENARIO_Y_SIGN,
            radius: nebula.radius,
        })
        .collect();
    let mut header = header(options);
    if let Some(setup) = &galaxy.setup {
        shape_first(&mut header, &setup.shape);
    }
    let draft = Draft {
        header,
        systems,
        lanes: lane_pairs(galaxy, &omitted),
        nebulae,
    };
    (draft, report)
}

/// Move the `supports_shape` line naming `shape` ahead of the others, when the header
/// lists it.
fn shape_first(header: &mut Vec<u8>, shape: &str) {
    let Ok(text) = std::str::from_utf8(header) else {
        return;
    };
    let line = format!(
        "	supports_shape = {shape}
"
    );
    let Some(at) = text.find(&line) else {
        return;
    };
    let first = text
        .find("	supports_shape = ")
        .expect("the line found is one");
    if first == at {
        return;
    }
    let mut moved = String::with_capacity(text.len());
    moved.push_str(&text[..first]);
    moved.push_str(&line);
    moved.push_str(&text[first..at]);
    moved.push_str(&text[at + line.len()..]);
    *header = moved.into_bytes();
}

/// The lines above a save's export that say where it came from and what it lacks.
fn comment_block(save: &str, draft: &Draft, report: &ExportReport) -> String {
    let save: String = save.chars().filter(|c| !matches!(c, '\n' | '\r')).collect();
    let seats = draft
        .systems
        .iter()
        .filter(|system| system.spawn != SpawnDraft::None)
        .count();
    let mut lines = vec![
        format!("# Exported by Stellaris Galaxy Forge from {save}"),
        format!(
            "# Systems: {} · Empire seats: {seats} · Nebulae: {}",
            draft.systems.len(),
            draft.nebulae.len()
        ),
    ];
    if let Some(needs) = report.needs() {
        lines.push(format!("# Needs: {needs} (initializers from DLC or mods)"));
    }
    if let Some(dropped) = report.dropped.summary() {
        lines.push(format!("# Not carried over: {dropped}"));
    }
    if let Some(omitted) = report.omitted_summary() {
        lines.push(format!("# Left out: {omitted} (the game adds its own)"));
    }
    lines.iter().map(|line| format!("{line}\n")).collect()
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

/// The header `graph` is exported under: its own core radius and one empire slot per
/// home system it holds, or, when it holds none, slots sized from its systems (see
/// [`SYSTEMS_PER_EMPIRE`]). The game seats `max + 1` empires, so the count is one less
/// than the seats.
pub fn options_for(graph: &GalaxyGraph, name: &str) -> ScenarioOptions {
    let seats = report::categories(graph)
        .values()
        .filter(|&&category| category == Category::Home)
        .count();
    let max = match seats {
        0 => empire_slots(graph.systems.len()),
        seats => as_u32(seats.saturating_sub(1)),
    };
    ScenarioOptions {
        name: quotable(name),
        core_radius: graph.core_radius,
        num_empires: (0, max),
        exported_from: None,
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
        exported_from: None,
    };
    let mut text = match profile {
        ScenarioProfile::Plain => header(&options),
        ScenarioProfile::PaintAGalaxy => {
            let seats = SeatCounts::from_scripts(0, []);
            paint::header(&options, &paint::HeaderCounts::sized(0, seats, 0, 0))
        }
    };
    text.extend_from_slice(FOOTER);
    Session::from_document(None, Document::from_scenario_bytes(text)?)
}

/// Open a save's galaxy as a new, unsaved scenario named after the save's file stem,
/// with the report of what the scenario lacks. The save is only read.
pub fn open_save_as_scenario(
    path: &Path,
    resolve: NameResolver<'_>,
    sources: SourceResolver<'_>,
    profile: ScenarioProfile,
) -> Result<(Session, ExportReport), SessionError> {
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
    let options = ScenarioOptions {
        exported_from: path.file_name().map(|f| f.to_string_lossy().into_owned()),
        ..options_for(&save.graph, &name)
    };
    let (text, report) = scenario_text(&save.graph, &options, resolve, sources, profile);
    let session = Session::from_document(None, Document::from_scenario_bytes(text)?)?;
    Ok((session, report))
}

/// Every undirected lane between systems the draft holds once, lower id first,
/// ascending.
fn lane_pairs(galaxy: &Galaxy, omitted: &BTreeSet<u32>) -> Vec<(u32, u32)> {
    let mut pairs = BTreeSet::new();
    let held = |id: u32| galaxy.systems.contains_key(&id) && !omitted.contains(&id);
    for system in galaxy.order.iter().filter_map(|id| galaxy.systems.get(id)) {
        if !held(system.id) {
            continue;
        }
        for lane in &system.lanes {
            if lane.to != system.id && held(lane.to) {
                pairs.insert((system.id.min(lane.to), system.id.max(lane.to)));
            }
        }
    }
    pairs.into_iter().collect()
}

/// The localised name when the resolver knows the key, else the no-game-data stand-in,
/// which keeps a key a key so the game can still look it up.
pub(super) fn name_of(name: &NameTemplate, resolve: NameResolver<'_>) -> String {
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
