//! A save's fallen empires are not copied: the mod rebuilds each one at game start in a
//! typed zone, so their clusters are left out and a zone of the right kind is centred
//! on each old capital, anchored to a system created for it. The kept systems that had
//! a lane into the cluster are linked to the zone by a custom connection, so the mod
//! lays the fallen empire's hyperlanes where the save had them.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use super::add_flags;
use crate::as_u32;
use crate::emit::rounded;
use crate::export::policy::Category;
use crate::export::{
    Draft, ExportReport, FallenEmpireReport, SpawnDraft, SystemDraft, name_of, report,
};
use crate::format::scenario::fe_link::{self, FeLinkFlags, LINK_REACH, MOST_IDS, TO_PREFIX};
use crate::format::scenario::fe_zone::{
    self, DEFAULT_DISTANCE, FE_ZONE_DISTANCES, FeDirection, FeKind, FeZone, Site,
};
use crate::format::scenario::paint::{AUTOMATIC_INITIALIZER_FLAG, RL_BASIC};
use crate::projections::galaxy::GalaxyGraph;
use crate::search::NameResolver;

const FALLEN_EMPIRE: &str = "fallen_empire";
const AWAKENED_FALLEN_EMPIRE: &str = "awakened_fallen_empire";
/// How far from a fallen empire's capital its unowned systems (the holy worlds) reach.
const CLUSTER_REACH: f64 = 120.0;
/// How far a created anchor keeps from every system the draft holds.
const ANCHOR_CLEARANCE: f64 = 20.0;
/// How far from the capital the fallback looks for an existing anchor.
const FALLBACK_REACH: f64 = 200.0;
/// The mod's own table (`events/painted_galaxy_fe.txt`): a capital's initializer prefix
/// names the fallen empire's kind.
const FE_KINDS: [(&str, FeKind); 6] = [
    ("fallen_machine", FeKind::Machine),
    ("fallen_hive", FeKind::Hive),
    ("fallen_1", FeKind::Materialist),
    ("fallen_2", FeKind::Spiritualist),
    ("fallen_3", FeKind::Xenophile),
    ("fallen_4", FeKind::Xenophobe),
];

/// The distances an anchor is tried at: the mod's default and the next one ahead, then
/// the rest nearest first.
fn anchor_distances() -> impl Iterator<Item = u16> {
    let all: &'static [u16] = &FE_ZONE_DISTANCES;
    let default = all
        .iter()
        .position(|&d| d == DEFAULT_DISTANCE)
        .expect("default distance");
    let ahead = &all[default..default + 2];
    ahead
        .iter()
        .chain(all.iter().filter(move |d| !ahead.contains(d)))
        .copied()
}

/// A fallen empire as the save holds it: where its capital stands in the draft, which
/// kind the mod should rebuild there, and the systems to leave out for it.
struct FallenEmpire {
    name: String,
    capital: (f64, f64),
    kind: FeKind,
    cluster: BTreeSet<u32>,
}

/// Every fallen empire with a capital the draft holds, ascending by country id. A
/// cluster is the capital, every system the country owns, every fallen empire system
/// within [`CLUSTER_REACH`] of the capital, and every generic system inside the ring
/// the mod fills at the capital; a playable capital or a system in an earlier cluster
/// is never taken.
fn fallen_empires(
    draft: &Draft,
    graph: &GalaxyGraph,
    spawns: &BTreeSet<u32>,
    resolve: NameResolver<'_>,
) -> Vec<FallenEmpire> {
    let categories = report::categories(graph);
    let positions: HashMap<u32, (f64, f64)> = draft
        .systems
        .iter()
        .map(|system| (system.id, (system.x, system.y)))
        .collect();
    let mut countries: Vec<_> = graph
        .countries
        .iter()
        .filter(|country| {
            matches!(
                country.country_type.as_str(),
                FALLEN_EMPIRE | AWAKENED_FALLEN_EMPIRE
            )
        })
        .collect();
    countries.sort_by_key(|country| country.id);
    let mut claimed: HashSet<u32> = HashSet::new();
    let mut empires = Vec::new();
    for country in countries {
        let Some(capital) = country
            .capital_system
            .and_then(|id| positions.get(&id).map(|at| (id, *at)))
        else {
            continue;
        };
        let (capital_id, at) = capital;
        let seat = &graph.systems[&capital_id];
        let cluster: BTreeSet<u32> = draft
            .systems
            .iter()
            .filter(|system| {
                let node = &graph.systems[&system.id];
                let position = (system.x, system.y);
                let near = fe_zone::distance(position, at) <= CLUSTER_REACH;
                system.id == capital_id
                    || node.owner == Some(country.id)
                    || match categories.get(&system.id) {
                        Some(Category::FallenEmpire) => near,
                        Some(Category::Generic) => fe_zone::inside(at, position),
                        _ => false,
                    }
            })
            .map(|system| system.id)
            .filter(|id| !spawns.contains(id) && !claimed.contains(id))
            .collect();
        claimed.extend(cluster.iter().copied());
        empires.push(FallenEmpire {
            name: name_of(&country.name, resolve),
            capital: at,
            kind: fallen_kind(&seat.initializer),
            cluster,
        });
    }
    empires
}

/// The kind the mod's own table gives a capital's initializer, `Random` for one it does
/// not list.
fn fallen_kind(initializer: &str) -> FeKind {
    FE_KINDS
        .iter()
        .find(|(prefix, _)| initializer.starts_with(prefix))
        .map_or(FeKind::Random, |(_, kind)| *kind)
}

/// Leave out each fallen empire's cluster and centre a typed, preferred zone on its old
/// capital: on an anchor created for it where the old spot is clear, else on the
/// existing system whose nearest clear grid position lies closest. The kept systems
/// with a lane into the cluster are linked to the zone, under the ids 0, 1, 2… in
/// fallen empire order. Returns the zones placed, keyed by anchor.
pub(super) fn place_fallen_empires(
    draft: &mut Draft,
    report: &mut ExportReport,
    graph: &GalaxyGraph,
    spawns: &BTreeSet<u32>,
    resolve: NameResolver<'_>,
) -> BTreeMap<u32, FeZone> {
    let mut typed: BTreeMap<u32, FeZone> = BTreeMap::new();
    let mut centres: Vec<(f64, f64)> = Vec::new();
    let mut next_id = draft
        .systems
        .iter()
        .map(|system| system.id)
        .max()
        .map_or(0, |id| id + 1);
    let empires = fallen_empires(draft, graph, spawns, resolve);
    let clustered: HashSet<u32> = empires
        .iter()
        .flat_map(|empire| empire.cluster.iter().copied())
        .collect();
    let mut next_link: u8 = 0;
    for empire in empires {
        draft
            .systems
            .retain(|system| !empire.cluster.contains(&system.id));
        let neighbours = cluster_neighbours(draft, &empire.cluster, &clustered);
        leave_out_lanes(draft, &empire.cluster);
        let placed = match anchor_position(draft, empire.capital, &centres) {
            Some((at, direction, distance)) => {
                let id = next_id;
                next_id += 1;
                let zone = typed_zone(direction, distance, empire.kind);
                let mut anchor = SystemDraft {
                    id,
                    name: String::new(),
                    x: at.0,
                    y: at.1,
                    initializer: Some(RL_BASIC.to_owned()),
                    spawn: SpawnDraft::None,
                    effect: None,
                };
                add_flags(&mut anchor, [AUTOMATIC_INITIALIZER_FLAG.to_owned()]);
                add_flags(&mut anchor, fe_zone::flags(&zone));
                if let Some(nearest) = nearest_system(draft, at) {
                    draft.lanes.push((nearest.min(id), nearest.max(id)));
                }
                draft.systems.push(anchor);
                centres.push(empire.capital);
                typed.insert(id, zone);
                Some((id, true))
            }
            None => fallback_zone(draft, &empire, &typed, &centres).map(|(id, zone)| {
                let index = draft
                    .systems
                    .iter()
                    .position(|system| system.id == id)
                    .expect("the fallback anchor is in the draft");
                let anchor = &mut draft.systems[index];
                centres.push(fe_zone::centre((anchor.x, anchor.y), &zone));
                add_flags(anchor, fe_zone::flags(&zone));
                typed.insert(id, zone);
                (id, false)
            }),
        };
        let links = match placed {
            Some((anchor, _)) if !neighbours.is_empty() && next_link < MOST_IDS => {
                let centre = *centres.last().expect("the placed zone's centre");
                let near = within_reach(draft, &neighbours, centre);
                link_neighbours(draft, anchor, &near, next_link);
                next_link += 1;
                as_u32(near.len())
            }
            _ => 0,
        };
        report.fallen_empires.push(FallenEmpireReport {
            name: empire.name,
            kind: empire.kind,
            systems_left_out: as_u32(empire.cluster.len()),
            anchor: placed.map(|(id, _)| id),
            exact: placed.is_some_and(|(_, exact)| exact),
            links,
        });
    }
    draft.lanes.sort_unstable();
    draft.lanes.dedup();
    typed
}

/// The kept systems with a lane into `cluster`, ascending: in no cluster at all, so
/// the flag written on one stays in the file.
fn cluster_neighbours(
    draft: &Draft,
    cluster: &BTreeSet<u32>,
    clustered: &HashSet<u32>,
) -> BTreeSet<u32> {
    draft
        .lanes
        .iter()
        .filter_map(
            |&(a, b)| match (cluster.contains(&a), cluster.contains(&b)) {
                (true, false) => Some(b),
                (false, true) => Some(a),
                _ => None,
            },
        )
        .filter(|id| !clustered.contains(id))
        .collect()
}

/// The neighbours worth linking: those within the mod's own reach of the zone's centre
/// whose lane to the ring would cross no kept lane, or the nearest one when none is. The
/// old cluster reached up to [`CLUSTER_REACH`] out and the new one stays inside its ring,
/// so a lane to the far side of the old cluster would cross empty space and other lanes,
/// which the game's own generator never lays.
fn within_reach(draft: &Draft, neighbours: &BTreeSet<u32>, centre: (f64, f64)) -> BTreeSet<u32> {
    let at = |id: u32| {
        draft
            .systems
            .iter()
            .find(|system| system.id == id)
            .map(|system| (system.x, system.y))
    };
    let mut by_distance: Vec<(f64, u32, (f64, f64))> = neighbours
        .iter()
        .filter_map(|&id| at(id).map(|point| (fe_zone::distance(point, centre), id, point)))
        .collect();
    by_distance.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)));
    let crosses_a_lane = |id: u32, from: (f64, f64)| {
        let reach = fe_zone::distance(from, centre);
        let t = (reach - fe_zone::FE_ZONE_RADIUS).max(0.0) / reach;
        let to = (
            from.0 + (centre.0 - from.0) * t,
            from.1 + (centre.1 - from.1) * t,
        );
        draft.lanes.iter().any(|&(a, b)| {
            a != id
                && b != id
                && at(a)
                    .zip(at(b))
                    .is_some_and(|(p, q)| segments_cross(from, to, p, q))
        })
    };
    let near: BTreeSet<u32> = by_distance
        .iter()
        .filter(|(distance, id, from)| *distance <= LINK_REACH && !crosses_a_lane(*id, *from))
        .map(|(_, id, _)| *id)
        .collect();
    if near.is_empty() {
        by_distance
            .first()
            .map(|(_, id, _)| *id)
            .into_iter()
            .collect()
    } else {
        near
    }
}

/// Whether the open segments `a`–`b` and `c`–`d` cross.
fn segments_cross(a: (f64, f64), b: (f64, f64), c: (f64, f64), d: (f64, f64)) -> bool {
    let side = |p: (f64, f64), q: (f64, f64), r: (f64, f64)| {
        (q.0 - p.0) * (r.1 - p.1) - (q.1 - p.1) * (r.0 - p.0)
    };
    let (s1, s2) = (side(c, d, a), side(c, d, b));
    let (s3, s4) = (side(a, b, c), side(a, b, d));
    (s1 > 0.0) != (s2 > 0.0) && (s3 > 0.0) != (s4 > 0.0)
}

/// The anchor takes custom connections under `id` and each of `neighbours` links to it.
fn link_neighbours(draft: &mut Draft, anchor: u32, neighbours: &BTreeSet<u32>, id: u8) {
    let link = FeLinkFlags {
        custom: true,
        id: Some(id),
        to: Vec::new(),
    };
    for system in &mut draft.systems {
        if system.id == anchor {
            add_flags(system, fe_link::flags(&link));
        } else if neighbours.contains(&system.id) {
            add_flags(system, [format!("{TO_PREFIX}{id}")]);
        }
    }
}

/// Drop every lane into `cluster`; a kept system that loses its last lane gets one to
/// its nearest kept system, so leaving a cluster out strands nothing.
fn leave_out_lanes(draft: &mut Draft, cluster: &BTreeSet<u32>) {
    let mut touched: BTreeSet<u32> = BTreeSet::new();
    draft.lanes.retain(|&(a, b)| {
        let dropped = cluster.contains(&a) || cluster.contains(&b);
        if dropped {
            touched.extend([a, b].into_iter().filter(|id| !cluster.contains(id)));
        }
        !dropped
    });
    let linked: HashSet<u32> = draft.lanes.iter().flat_map(|&(a, b)| [a, b]).collect();
    for id in touched.into_iter().filter(|id| !linked.contains(id)) {
        let Some(at) = draft
            .systems
            .iter()
            .find(|system| system.id == id)
            .map(|system| (system.x, system.y))
        else {
            continue;
        };
        let nearest = draft
            .systems
            .iter()
            .filter(|system| system.id != id)
            .map(|system| (fe_zone::distance((system.x, system.y), at), system.id))
            .min_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)));
        if let Some((_, to)) = nearest {
            draft.lanes.push((id.min(to), id.max(to)));
        }
    }
}

/// Where to create the anchor whose zone is centred on `capital`: the first distance
/// of [`anchor_distances`] with a direction whose anchor lies on the map, clear of every
/// system by [`ANCHOR_CLEARANCE`] and outside every ring, and among those directions the
/// one farthest from its nearest system. `None` when the ring at `capital` is not clear.
fn anchor_position(
    draft: &Draft,
    capital: (f64, f64),
    placed: &[(f64, f64)],
) -> Option<((f64, f64), FeDirection, u16)> {
    let systems: Vec<(f64, f64)> = draft
        .systems
        .iter()
        .map(|system| (system.x, system.y))
        .collect();
    let ring_clear = !fe_zone::is_off_map(capital)
        && !systems.iter().any(|&at| fe_zone::inside(capital, at))
        && !placed
            .iter()
            .any(|&other| fe_zone::overlaps(capital, other));
    if !ring_clear {
        return None;
    }
    let rings = || placed.iter().copied().chain(std::iter::once(capital));
    anchor_distances().find_map(|distance| {
        let mut best: Option<((f64, f64), FeDirection, f64)> = None;
        for direction in FeDirection::ALL {
            let zone = typed_zone(direction, distance, FeKind::Random);
            let (dx, dy) = fe_zone::centre((0.0, 0.0), &zone);
            let anchor = (rounded(capital.0 - dx), rounded(capital.1 - dy));
            let nearest = systems
                .iter()
                .map(|&at| fe_zone::distance(anchor, at))
                .fold(f64::INFINITY, f64::min);
            let clear = !fe_zone::is_off_map(anchor)
                && nearest >= ANCHOR_CLEARANCE
                && !rings().any(|centre| fe_zone::inside(centre, anchor));
            if clear && best.is_none_or(|(_, _, farthest)| nearest > farthest) {
                best = Some((anchor, direction, nearest));
            }
        }
        best.map(|(anchor, direction, _)| (anchor, direction, distance))
    })
}

/// The zone nearest the old capital over the existing systems within
/// [`FALLBACK_REACH`] of it, when its own spot is not clear.
fn fallback_zone(
    draft: &Draft,
    empire: &FallenEmpire,
    typed: &BTreeMap<u32, FeZone>,
    placed: &[(f64, f64)],
) -> Option<(u32, FeZone)> {
    let sites: Vec<Site<'_>> = draft
        .systems
        .iter()
        .map(|system| Site {
            id: system.id,
            x: system.x,
            y: system.y,
            zone: typed.get(&system.id),
            linked: false,
        })
        .collect();
    let anchors: Vec<Site<'_>> = sites
        .iter()
        .filter(|site| fe_zone::distance((site.x, site.y), empire.capital) <= FALLBACK_REACH)
        .copied()
        .collect();
    fe_zone::nearest_zone(empire.capital, empire.kind, &anchors, &sites, placed)
}

fn typed_zone(direction: FeDirection, distance: u16, kind: FeKind) -> FeZone {
    FeZone {
        direction,
        kind,
        distance,
        preferred: true,
        fallback: false,
    }
}

/// The system of the draft closest to `at`, the lower id on a tie.
fn nearest_system(draft: &Draft, at: (f64, f64)) -> Option<u32> {
    draft
        .systems
        .iter()
        .map(|system| (fe_zone::distance((system.x, system.y), at), system.id))
        .min_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)))
        .map(|(_, id)| id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_capitals_initializer_names_the_fallen_empires_kind() {
        assert_eq!(fallen_kind("fallen_1"), FeKind::Materialist);
        assert_eq!(fallen_kind("fallen_1_2"), FeKind::Materialist);
        assert_eq!(fallen_kind("fallen_2"), FeKind::Spiritualist);
        assert_eq!(fallen_kind("fallen_3"), FeKind::Xenophile);
        assert_eq!(fallen_kind("fallen_4"), FeKind::Xenophobe);
        assert_eq!(fallen_kind("fallen_machine"), FeKind::Machine);
        assert_eq!(fallen_kind("fallen_hive"), FeKind::Hive);
        assert_eq!(fallen_kind("fallen_col_1"), FeKind::Random);
        assert_eq!(fallen_kind(""), FeKind::Random);
    }
}
