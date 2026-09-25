//! What the graph says about a nebula: where its centre may go, how wide it may be, what
//! it may be called, and (the one decision every op that changes what a cloud covers
//! shares) who joins it and who leaves.
//!
//! The game never re-derives a nebula's members from positions, so a save's writer has to
//! rewrite the member lines whenever a boundary is crossed, whether the system moved or
//! the cloud did; a scenario's members follow its radius, so its writer ignores them.
//! [`decide_membership`] is given the nebula list as the op will leave it and says who
//! moves.

use std::fmt::Write as _;

use crate::emit::{coord, rounded};
use crate::ops::rules::check_name;
use crate::ops::{Op, OpError};
use crate::plural;
use crate::projections::galaxy::{GalaxyGraph, Nebula, nearest_prospective};
use crate::projections::name::NameTemplate;

/// The largest radius an op will write. The sample galaxy is 500 across, so this is a
/// guard against a stray keystroke rather than a rule the game states.
const MAX_RADIUS: f64 = 1000.0;

/// One system entering or leaving a nebula's member list.
pub(crate) struct Membership {
    pub system: u32,
    pub nebula: usize,
    pub joined: bool,
}

/// Where a system will be when the op lands.
pub(crate) struct Prospect {
    pub id: u32,
    pub x: f64,
    pub y: f64,
}

/// Where a cloud stands and where it is going, with the systems its radius reaches on
/// either side of the move.
pub(crate) struct NebulaMove {
    pub index: usize,
    pub name: String,
    pub from: (f64, f64),
    /// The centre as it will be written, rounded to the five decimals the file holds.
    pub to: (f64, f64),
    pub covered_before: usize,
    pub covered_after: usize,
}

/// A new cloud, where it lands and what it takes from its neighbours.
pub(crate) struct NebulaAdd {
    /// Its index once written: a new nebula always lands last.
    pub index: usize,
    pub name: String,
    pub x: f64,
    pub y: f64,
    pub radius: f64,
    pub changes: Vec<Membership>,
    /// The systems its own member lines list, ascending.
    pub members: Vec<u32>,
}

/// The cloud an op is erasing and where its members go.
pub(crate) struct NebulaRemove {
    pub index: usize,
    pub name: String,
    /// The cloud as it stands, for the inverse.
    pub nebula: Nebula,
    pub changes: Vec<Membership>,
}

/// A cloud's name before and after. A name moves nothing, so nobody changes cloud.
pub(crate) struct NebulaName {
    pub index: usize,
    pub from: String,
    pub to: String,
    /// Whether the rewrite threw away a `variables` block the old name substituted into.
    pub dropped_variables: bool,
}

/// A cloud's radius before and after, and who that moves.
pub(crate) struct NebulaRadius {
    pub index: usize,
    pub name: String,
    pub from: f64,
    pub to: f64,
    pub changes: Vec<Membership>,
}

/// What the graph says about moving the `index`th cloud to (x, y). Shared by both
/// formats' writers, which differ in where the centre is written and in whether member
/// lines have to follow it.
pub(crate) fn decide_move(
    graph: &GalaxyGraph,
    index: usize,
    x: f64,
    y: f64,
) -> Result<NebulaMove, OpError> {
    if !x.is_finite() || !y.is_finite() {
        return Err(OpError::NotFinite);
    }
    let nebula = graph
        .nebulae
        .get(index)
        .ok_or(OpError::UnknownNebula(index))?;
    let to = (rounded(x), rounded(y));
    let reaches = |cx: f64, cy: f64| {
        graph
            .systems
            .values()
            .filter(|s| (s.x - cx).hypot(s.y - cy) <= nebula.radius)
            .count()
    };
    Ok(NebulaMove {
        index,
        name: nebula.display_name(),
        from: (nebula.x, nebula.y),
        to,
        covered_before: reaches(nebula.x, nebula.y),
        covered_after: reaches(to.0, to.1),
    })
}

pub(crate) fn decide_add(
    graph: &GalaxyGraph,
    x: f64,
    y: f64,
    radius: f64,
    name: Option<&str>,
) -> Result<NebulaAdd, OpError> {
    if !x.is_finite() || !y.is_finite() {
        return Err(OpError::NotFinite);
    }
    check_radius(radius)?;
    if let Some(name) = name {
        check_name(name)?;
    }
    let index = graph.nebulae.len();
    let (x, y, radius) = (rounded(x), rounded(y), rounded(radius));
    let mut prospective = prospective(graph);
    prospective.push(Some(Nebula {
        name: NameTemplate::default(),
        x,
        y,
        radius,
        systems: Vec::new(),
        turbulence: None,
    }));
    let changes = decide_membership(graph, &prospective, &all_systems(graph))?;
    let members = changes
        .iter()
        .filter(|c| c.joined && c.nebula == index)
        .map(|c| c.system)
        .collect();
    Ok(NebulaAdd {
        index,
        name: name.unwrap_or_default().to_owned(),
        x,
        y,
        radius,
        changes,
        members,
    })
}

pub(crate) fn decide_remove(graph: &GalaxyGraph, index: usize) -> Result<NebulaRemove, OpError> {
    let nebula = graph
        .nebulae
        .get(index)
        .ok_or(OpError::UnknownNebula(index))?
        .clone();
    let mut prospective = prospective(graph);
    prospective[index] = None;
    let changes = decide_membership(graph, &prospective, &all_systems(graph))?;
    Ok(NebulaRemove {
        index,
        name: nebula.display_name(),
        nebula,
        changes,
    })
}

pub(crate) fn decide_radius(
    graph: &GalaxyGraph,
    index: usize,
    radius: f64,
) -> Result<NebulaRadius, OpError> {
    check_radius(radius)?;
    let nebula = graph
        .nebulae
        .get(index)
        .ok_or(OpError::UnknownNebula(index))?;
    let to = rounded(radius);
    let mut prospective = prospective(graph);
    if let Some(patched) = &mut prospective[index] {
        patched.radius = to;
    }
    let changes = decide_membership(graph, &prospective, &all_systems(graph))?;
    Ok(NebulaRadius {
        index,
        name: nebula.display_name(),
        from: nebula.radius,
        to,
        changes,
    })
}

/// What the graph says about renaming the `index`th cloud. Shared by both formats'
/// writers, which differ only in where the name is written.
pub(crate) fn decide_name(
    graph: &GalaxyGraph,
    index: usize,
    name: &str,
) -> Result<NebulaName, OpError> {
    check_name(name)?;
    let nebula = graph
        .nebulae
        .get(index)
        .ok_or(OpError::UnknownNebula(index))?;
    Ok(NebulaName {
        index,
        from: nebula.name.key.clone(),
        to: name.to_owned(),
        dropped_variables: false,
    })
}

/// Who joins and who leaves when the nebula list becomes `prospective` (a gap stands for
/// one the op erases) and each of `subjects` stands where it says. A system belongs to
/// the nearest cloud covering it, which is what the game itself writes; leaves come
/// before the join that follows them, systems ascending.
pub(crate) fn decide_membership(
    graph: &GalaxyGraph,
    prospective: &[Option<Nebula>],
    subjects: &[Prospect],
) -> Result<Vec<Membership>, OpError> {
    let mut changes = Vec::new();
    for subject in subjects {
        let system = graph
            .systems
            .get(&subject.id)
            .ok_or(OpError::UnknownSystem(subject.id))?;
        let now = nearest_prospective(prospective, subject.x, subject.y);
        if now == system.nebula {
            continue;
        }
        if let Some(nebula) = system.nebula {
            changes.push(Membership {
                system: subject.id,
                nebula,
                joined: false,
            });
        }
        if let Some(nebula) = now {
            changes.push(Membership {
                system: subject.id,
                nebula,
                joined: true,
            });
        }
    }
    Ok(changes)
}

/// The nebula list as it stands, ready for an op to push, blank out or patch one entry.
pub(crate) fn prospective(graph: &GalaxyGraph) -> Vec<Option<Nebula>> {
    graph.nebulae.iter().cloned().map(Some).collect()
}

/// Every system the graph holds, at the position it holds, ascending.
pub(crate) fn all_systems(graph: &GalaxyGraph) -> Vec<Prospect> {
    let mut ids: Vec<u32> = graph.systems.keys().copied().collect();
    ids.sort_unstable();
    ids.into_iter()
        .map(|id| {
            let system = &graph.systems[&id];
            Prospect {
                id,
                x: system.x,
                y: system.y,
            }
        })
        .collect()
}

/// A radius has to be a positive number the galaxy could hold.
fn check_radius(radius: f64) -> Result<(), OpError> {
    if !radius.is_finite() {
        return Err(OpError::NotFinite);
    }
    if radius <= 0.0 {
        return Err(OpError::InvalidRadius {
            radius,
            reason: "a nebula's radius must be greater than zero".to_owned(),
        });
    }
    if radius > MAX_RADIUS {
        return Err(OpError::InvalidRadius {
            radius,
            reason: format!("a nebula's radius may not exceed {}", coord(MAX_RADIUS)),
        });
    }
    Ok(())
}

impl NebulaMove {
    pub fn describe(&self) -> String {
        format!(
            "Moved {} to ({}, {}); its radius now covers {} (was {})",
            self.name,
            coord(self.to.0),
            coord(self.to.1),
            plural(self.covered_after, "system"),
            self.covered_before
        )
    }

    pub fn inverse(&self) -> Op {
        Op::MoveNebula {
            index: self.index,
            x: self.from.0,
            y: self.from.1,
        }
    }
}

impl NebulaAdd {
    pub fn describe(&self) -> String {
        let named = if self.name.is_empty() {
            "Added nebula".to_owned()
        } else {
            format!("Added nebula \"{}\"", self.name)
        };
        let joined = self.members.len();
        let covers = if joined == 0 {
            "; covers no systems".to_owned()
        } else {
            format!("; {} joined", plural(joined, "system"))
        };
        format!(
            "{named} at ({}, {}) radius {}{covers}",
            coord(self.x),
            coord(self.y),
            coord(self.radius)
        )
    }

    pub fn inverse(&self) -> Op {
        Op::RemoveNebula { index: self.index }
    }
}

impl NebulaRemove {
    pub fn describe(&self, graph: &GalaxyGraph) -> String {
        let released = self
            .changes
            .iter()
            .filter(|c| !c.joined && c.nebula == self.index)
            .count();
        let mut out = format!(
            "Removed nebula \"{}\" ({} released",
            self.name,
            plural(released, "system")
        );
        out.push_str(&joins_elsewhere(graph, &self.changes, self.index));
        out.push(')');
        out
    }

    pub fn inverse(&self) -> Op {
        Op::AddNebula {
            x: self.nebula.x,
            y: self.nebula.y,
            radius: self.nebula.radius,
            name: (!self.nebula.name.key.is_empty()).then(|| self.nebula.name.key.clone()),
        }
    }
}

impl NebulaName {
    pub fn describe(&self) -> String {
        let mut out = format!(
            "Renamed nebula {} from \"{}\" to \"{}\"",
            self.index, self.from, self.to
        );
        if self.dropped_variables {
            out.push_str("; dropped the variables the old name substituted");
        }
        out
    }

    pub fn inverse(&self) -> Op {
        Op::SetNebulaName {
            index: self.index,
            name: self.from.clone(),
        }
    }
}

impl NebulaRadius {
    pub fn describe(&self) -> String {
        format!(
            "Set {} radius to {} (was {}){}",
            self.name,
            coord(self.to),
            coord(self.from),
            traffic(&self.changes, self.index)
        )
    }

    pub fn inverse(&self) -> Op {
        Op::SetNebulaRadius {
            index: self.index,
            radius: self.from,
        }
    }
}

/// `; left <nebula>` / `; joined <nebula>` per change, with the system named first when
/// `name_systems` is set.
pub(crate) fn describe_membership(
    graph: &GalaxyGraph,
    changes: &[Membership],
    name_systems: bool,
) -> String {
    let mut out = String::new();
    for c in changes {
        let nebula = graph.nebulae[c.nebula].display_name();
        let verb = if c.joined { "joined" } else { "left" };
        if name_systems {
            let system = graph.systems[&c.system].display_name();
            write!(out, "; {system} {verb} {nebula}").unwrap();
        } else {
            write!(out, "; {verb} {nebula}").unwrap();
        }
    }
    out
}

/// `; 3 systems joined; 1 system left` for the cloud `nebula`, empty when nobody moved.
fn traffic(changes: &[Membership], nebula: usize) -> String {
    let joined = changes
        .iter()
        .filter(|c| c.joined && c.nebula == nebula)
        .count();
    let left = changes
        .iter()
        .filter(|c| !c.joined && c.nebula == nebula)
        .count();
    let mut out = String::new();
    if joined > 0 {
        write!(out, "; {} joined", plural(joined, "system")).unwrap();
    }
    if left > 0 {
        write!(out, "; {} left", plural(left, "system")).unwrap();
    }
    out
}

/// `; 1 joined Heart of the Galaxy` per cloud that gained, `except` aside.
fn joins_elsewhere(graph: &GalaxyGraph, changes: &[Membership], except: usize) -> String {
    let mut gained: Vec<(usize, usize)> = Vec::new();
    for change in changes.iter().filter(|c| c.joined && c.nebula != except) {
        match gained.iter_mut().find(|(i, _)| *i == change.nebula) {
            Some((_, count)) => *count += 1,
            None => gained.push((change.nebula, 1)),
        }
    }
    let mut out = String::new();
    for (index, count) in gained {
        let name = graph.nebulae[index].display_name();
        write!(out, "; {count} joined {name}").unwrap();
    }
    out
}
