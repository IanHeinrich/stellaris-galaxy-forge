//! A cluster of the Special menu rolled for a document: its home at a spot and each other
//! system placed at random inside the range its chain gives from the system it leads from,
//! each built as the Special menu builds its layout, with the lanes the game lays.

use serde::{Deserialize, Serialize};
use sgf_core::ops::rules::added_group;
use sgf_core::ops::{LaneEnd, LanePair, NewSystem, Op, OpError, SystemAdd};
use sgf_core::session::Session;
use ts_rs::TS;

use super::save::{ForSaveError, Pick, PickAt, for_save_many};
use crate::GameData;
use crate::install::script::Range;
use crate::layouts::{Cluster, ClusterPlan, runs_scripts};
use crate::menu::document_clusters;
use crate::orbit_walk::draw;
use crate::rng::Rng;

/// Separates the draw of a cluster's places from the seeds of its systems.
const PLACE_STREAM: u64 = 0x706C_6163;
/// Where a link its chain states in jumps alone lands: one lane away, as long as the game's
/// lanes usually run (assumed: the game picks a system that is already there).
const ONE_LANE: Range = Range {
    min: 20.0,
    max: 50.0,
};
/// How many places a system is drawn at before it keeps one the add refuses.
const PLACE_TRIES: usize = 32;

/// A cluster rolled at a spot, as the picker previews it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ClusterRoll {
    /// Its systems, the home first, in the order the add writes them.
    pub members: Vec<ClusterMember>,
    /// Its lanes, each as two indices into `members`.
    pub lanes: Vec<(u32, u32)>,
}

/// One system of a [`ClusterRoll`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ClusterMember {
    /// The layout it is built from.
    pub layout: String,
    /// Its name, localised.
    pub name: String,
    pub x: f64,
    pub y: f64,
    pub star_class: String,
    /// Why the add refuses its place, as the add says it; `None` when the place is taken.
    pub refused: Option<String>,
}

/// A cluster rolled for a document, before anything is written.
#[derive(Debug)]
pub struct RolledCluster {
    pub cluster: &'static Cluster,
    /// Its systems, the home first, as [`for_save_many`] builds them.
    pub systems: Vec<SystemAdd>,
    /// Each lane as the indices into `systems` of the system it leads from and the one it
    /// leads to.
    pub links: Vec<(usize, usize)>,
    /// Why the add refuses each system's place, or `None`.
    pub refused: Vec<Option<OpError>>,
}

impl RolledCluster {
    /// The roll as the picker previews it.
    pub fn view(&self, gd: &GameData) -> ClusterRoll {
        let members = self
            .systems
            .iter()
            .zip(&self.refused)
            .map(|(add, refused)| ClusterMember {
                layout: add.spec.initializer.clone(),
                name: gd
                    .loc
                    .name(&add.spec.name)
                    .unwrap_or_else(|| add.spec.name.clone()),
                x: add.spec.x,
                y: add.spec.y,
                star_class: add.spec.star_class.clone(),
                refused: refused.as_ref().map(ToString::to_string),
            })
            .collect();
        let lanes = self
            .links
            .iter()
            .map(|&(from, to)| (from as u32, to as u32))
            .collect();
        ClusterRoll { members, lanes }
    }
}

/// The cluster keyed `key` rolled for `session`'s document from `seed`, its home at `at`: the
/// systems [`Cluster::plan`] writes into the document. Each other system is drawn inside the
/// range its chain gives from the system its lane leads from, again until the add takes its
/// place or [`PLACE_TRIES`] draws have been made, and is then built from its layout with
/// [`for_save_many`], which names them all from one draw. The same seed gives the same
/// cluster; another rolls places and systems again. Refused for a key the Special menu offers
/// the document no cluster for.
pub fn roll_cluster(
    gd: &GameData,
    session: &Session,
    seed: u64,
    at: (f64, f64),
    key: &str,
) -> Result<RolledCluster, ForSaveError> {
    let unknown = || ForSaveError::UnknownCluster(key.to_owned());
    let (cluster, ClusterPlan { layouts, links }) = document_clusters(gd, session)
        .into_iter()
        .find(|(cluster, _)| cluster.key == key)
        .ok_or_else(unknown)?;
    let mut rng = Rng::new(seed ^ PLACE_STREAM);
    let mut points = vec![at];
    for (i, layout) in layouts.iter().enumerate().skip(1) {
        let from = links
            .iter()
            .find(|&&(from, to)| to == i && from < i)
            .map(|&(from, _)| from)
            .ok_or_else(unknown)?;
        let reach = link_reach(gd, layouts[from], layout);
        let (ox, oy) = points[from];
        let mut point = (ox, oy);
        for _ in 0..PLACE_TRIES {
            let distance = draw::distance(&mut rng, reach);
            let angle = draw::any_angle(&mut rng).to_radians();
            point = (ox + distance * angle.cos(), oy + distance * angle.sin());
            let mut trial = points.clone();
            trial.push(point);
            if refusals(session, &trial)?
                .last()
                .is_some_and(Option::is_none)
            {
                break;
            }
        }
        points.push(point);
    }
    let placed: Vec<PickAt> = layouts
        .iter()
        .zip(&points)
        .map(|(layout, &at)| PickAt {
            pick: Pick::Layout((*layout).to_owned()),
            at,
        })
        .collect();
    let systems = for_save_many(gd, session, seed, &placed)?;
    let refused = refusals(session, &points)?;
    Ok(RolledCluster {
        cluster,
        systems,
        links,
        refused,
    })
}

/// The op that adds the cluster [`roll_cluster`] rolls, joined to the systems the document
/// holds by `joins`, each a system of the roll by its index and a held system's id, as one
/// step described by [`added_group`], every lane counted: in a save,
/// [`SaveQueries::add_systems_op`] for its systems and lanes, writing their anomalies, dig
/// sites and megastructures only with `extras`; in a document whose systems run their own
/// script, [`statements_op`]. Refused with nothing applied as the add refuses, a join naming a
/// system of neither among them, and as a save refuses its queries.
///
/// [`SaveQueries::add_systems_op`]: sgf_core::session::SaveQueries::add_systems_op
pub fn cluster_op(
    gd: &GameData,
    session: &Session,
    seed: u64,
    at: (f64, f64),
    key: &str,
    extras: bool,
    joins: &[(usize, u32)],
) -> Result<Op, ForSaveError> {
    let rolled = roll_cluster(gd, session, seed, at, key)?;
    let description = added_group(
        rolled.cluster.phrase,
        rolled.systems.len(),
        rolled.links.len() + joins.len(),
    );
    if !runs_scripts(session) {
        let lanes: Vec<(LaneEnd, LaneEnd)> = rolled
            .links
            .iter()
            .map(|&(from, to)| (new_end(from), new_end(to)))
            .chain(
                joins
                    .iter()
                    .map(|&(index, system)| (new_end(index), LaneEnd::Held { system })),
            )
            .collect();
        let save = session.save("adding systems")?;
        return Ok(save.add_systems_op(rolled.systems, &lanes, extras, Some(description))?);
    }
    let systems: Vec<(String, (f64, f64))> = rolled
        .systems
        .iter()
        .map(|add| (add.spec.initializer.clone(), (add.spec.x, add.spec.y)))
        .collect();
    statements_op(session, &systems, &rolled.links, joins, description)
}

/// The op that writes a system statement naming each of `systems`' initializers at its place,
/// which the game runs, with lanes between them by their indices in `links` and to the
/// systems the document holds in `joins`: one [`Op::AddSystems`] taking the ids the document
/// hands out next, and one [`Op::AddLanePairs`] when there are lanes, as one step described as
/// `description`. The ids are those the document's rule gives systems added one after
/// another. Refused with nothing applied for a join naming no system of either.
pub(super) fn statements_op(
    session: &Session,
    systems: &[(String, (f64, f64))],
    links: &[(usize, usize)],
    joins: &[(usize, u32)],
    description: String,
) -> Result<Op, ForSaveError> {
    let ids = session.next_system_ids(systems.len())?;
    let new = |index: usize| match ids.get(index) {
        Some(&id) => Ok(id),
        None => Err(OpError::UnknownSystem(
            session
                .next_system_ids(index + 1)?
                .last()
                .copied()
                .unwrap_or_default(),
        )),
    };
    let held = |system: u32| match session.graph().systems.contains_key(&system) {
        true => Ok(system),
        false => Err(OpError::UnknownSystem(system)),
    };
    let mut lanes = Vec::with_capacity(links.len() + joins.len());
    for &(from, to) in links {
        lanes.push((new(from)?, new(to)?));
    }
    for &(index, system) in joins {
        lanes.push((new(index)?, held(system)?));
    }
    let systems = ids
        .iter()
        .copied()
        .zip(systems)
        .map(|(system, (initializer, (x, y)))| NewSystem {
            system,
            x: *x,
            y: *y,
            name: None,
            initializer: Some(initializer.clone()),
            spawn_weight: None,
            spawn_script: None,
            statement: None,
        })
        .collect();
    let mut ops = vec![Op::AddSystems { systems }];
    if !lanes.is_empty() {
        let lanes = lanes
            .into_iter()
            .map(|(a, b)| LanePair {
                a,
                b,
                bridge: false,
            })
            .collect();
        ops.push(Op::AddLanePairs { lanes });
    }
    Ok(Op::Batch { description, ops })
}

fn new_end(index: usize) -> LaneEnd {
    LaneEnd::New {
        index: index as u32,
    }
}

/// How far from `from` its chain places `to`: the `distance`, or `min_distance` and
/// `max_distance`, of the block that spawns it, else [`ONE_LANE`].
fn link_reach(gd: &GameData, from: &str, to: &str) -> Range {
    gd.initializers
        .get(from)
        .and_then(|init| {
            init.spawn_reach
                .iter()
                .find(|(child, _)| child == to)
                .and_then(|(_, reach)| *reach)
        })
        .unwrap_or(ONE_LANE)
}

/// Why the add refuses each of `points` in `session`'s save, or `None` for each in a document
/// that places its systems where it is told.
fn refusals(
    session: &Session,
    points: &[(f64, f64)],
) -> Result<Vec<Option<OpError>>, ForSaveError> {
    match runs_scripts(session) {
        true => Ok(points.iter().map(|_| None).collect()),
        false => Ok(session.save("placing systems")?.place_refusals(points)?),
    }
}
