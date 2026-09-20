//! One nebula of the graph: the cloud, the systems it holds and the geometry of both.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::projections::galaxy::{SystemNode, display_template};
use crate::projections::name::NameTemplate;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Nebula {
    pub name: NameTemplate,
    pub x: f64,
    pub y: f64,
    pub radius: f64,
    pub systems: Vec<u32>,
}

impl Nebula {
    /// See [`display_template`].
    pub fn display_name(&self) -> String {
        display_template(&self.name)
    }
}

/// Fill each nebula's member list with the systems its radius covers, nearest nebula
/// first, as a document that stores no member lists needs. Systems are listed ascending.
pub(super) fn fill_by_radius(nebulae: &mut [Nebula], systems: &HashMap<u32, SystemNode>) {
    let mut ids: Vec<u32> = systems.keys().copied().collect();
    ids.sort_unstable();
    for id in ids {
        let system = &systems[&id];
        if let Some(i) = nearest_covering(nebulae, system.x, system.y) {
            nebulae[i].systems.push(id);
        }
    }
}

/// Whether the nebula's radius reaches the point.
pub(crate) fn covers(nebula: &Nebula, x: f64, y: f64) -> bool {
    (x - nebula.x).hypot(y - nebula.y) <= nebula.radius
}

/// The nebula whose centre is nearest the point among those covering it.
pub(crate) fn nearest_covering(nebulae: &[Nebula], x: f64, y: f64) -> Option<usize> {
    nearest(nebulae.iter().enumerate(), x, y)
}

/// The same over the list an op is planning, in which a gap is a nebula it erases.
pub(crate) fn nearest_prospective(nebulae: &[Option<Nebula>], x: f64, y: f64) -> Option<usize> {
    nearest(
        nebulae
            .iter()
            .enumerate()
            .filter_map(|(i, n)| Some((i, n.as_ref()?))),
        x,
        y,
    )
}

fn nearest<'a>(
    candidates: impl Iterator<Item = (usize, &'a Nebula)>,
    x: f64,
    y: f64,
) -> Option<usize> {
    candidates
        .filter(|(_, n)| covers(n, x, y))
        .min_by(|(_, a), (_, b)| {
            let da = (x - a.x).hypot(y - a.y);
            let db = (x - b.x).hypot(y - b.y);
            da.total_cmp(&db)
        })
        .map(|(i, _)| i)
}

/// Point each system at the nebula listing it (the last one in file order wins).
/// Returns the systems whose membership changed, ascending.
pub(super) fn assign(systems: &mut HashMap<u32, SystemNode>, nebulae: &[Nebula]) -> Vec<u32> {
    let mut listed: HashMap<u32, usize> = HashMap::new();
    for (i, nebula) in nebulae.iter().enumerate() {
        for &id in &nebula.systems {
            listed.insert(id, i);
        }
    }
    let mut changed = Vec::new();
    for system in systems.values_mut() {
        let nebula = listed.get(&system.id).copied();
        if system.nebula != nebula {
            system.nebula = nebula;
            changed.push(system.id);
        }
    }
    changed.sort_unstable();
    changed
}
