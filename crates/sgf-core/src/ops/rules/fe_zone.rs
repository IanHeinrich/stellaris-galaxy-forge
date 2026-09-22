//! What the graph says about a fallen empire zone: that its ring holds no other system
//! and that its centre is on the map, since Paint a Galaxy builds the fallen empire's
//! systems in that ring at game start. Taking a zone away is always allowed.
//!
//! [`candidates`] is the mod's own rule for the zones it places by itself, copied so
//! that the two tools agree on a map.

use crate::format::scenario::fe_zone::{
    self, DEFAULT_DISTANCE, FE_ZONE_RADIUS, FeDirection, FeKind, FeZone, Site,
};
use crate::ops::OpError;
use crate::projections::galaxy::{Galaxy, GalaxyGraph, SystemNode};

/// How far from the origin an automatic centre must stand: the mod's core guide plus
/// the radius.
const CORE_CLEARANCE: f64 = 100.0 + FE_ZONE_RADIUS;
/// Where the mod's L-Cluster guide stands and how far an automatic centre keeps from
/// it: the guide's 70 plus the radius.
const L_CLUSTER: (f64, f64) = (-420.0, -420.0);
const L_CLUSTER_CLEARANCE: f64 = 70.0 + FE_ZONE_RADIUS;

/// Whether `zone` may be written on `id`: `Some` is refused when the ring around its
/// centre holds another system or the centre lies off the map.
pub(crate) fn decide_set(
    graph: &GalaxyGraph,
    id: u32,
    zone: Option<&FeZone>,
) -> Result<(), OpError> {
    let anchor = graph.systems.get(&id).ok_or(OpError::UnknownSystem(id))?;
    let Some(zone) = zone else {
        return Ok(());
    };
    let centre = fe_zone::centre((anchor.x, anchor.y), zone);
    let obstacles = fe_zone::obstacles(graph, id, centre);
    if obstacles.off_map {
        return Err(OpError::FeZoneOffMap {
            anchor: label(anchor),
        });
    }
    match obstacles.blockers.first() {
        Some(blocker) => Err(OpError::FeZoneBlocked {
            anchor: label(anchor),
            blocker: label(blocker),
        }),
        None => Ok(()),
    }
}

/// What a message calls a system: its name, or `#N` when it has none.
pub(crate) fn label(system: &SystemNode) -> String {
    let name = system.display_name();
    if name.is_empty() {
        format!("#{}", system.id)
    } else {
        name
    }
}

/// Every system of `galaxy` as the automatic rule sees it, in file order.
pub fn sites(galaxy: &Galaxy) -> Vec<Site<'_>> {
    galaxy
        .order
        .iter()
        .filter_map(|id| galaxy.systems.get(id))
        .map(|system| Site {
            id: system.id,
            x: system.x,
            y: system.y,
            zone: system.fe_zone.as_ref(),
            linked: system.fe_link.custom,
        })
        .collect()
}

/// The zones the mod would place by itself, in system order: for every system that
/// anchors none, the first direction whose centre at the default distance keeps clear
/// of the core, the L-Cluster and the map's edge, holds no system in its ring, and
/// stands its own width from every zone already placed or accepted before it. A system
/// gets at most one; a system that anchors a zone already is left as it is.
pub fn candidates(sites: &[Site<'_>]) -> Vec<(u32, FeZone)> {
    let mut accepted: Vec<(f64, f64)> = sites.iter().filter_map(Site::centre).collect();
    let mut out = Vec::new();
    for site in sites.iter().filter(|site| site.zone.is_none()) {
        let Some(zone) = FeDirection::ALL.into_iter().find_map(|direction| {
            let zone = automatic(direction);
            let c = fe_zone::centre(site.position(), &zone);
            let clear = fe_zone::distance(c, (0.0, 0.0)) >= CORE_CLEARANCE
                && fe_zone::distance(c, L_CLUSTER) >= L_CLUSTER_CLEARANCE
                && !fe_zone::is_off_map(c)
                && !sites
                    .iter()
                    .any(|other| fe_zone::inside(c, other.position()))
                && !accepted.iter().any(|&placed| fe_zone::overlaps(c, placed));
            clear.then_some(zone)
        }) else {
            continue;
        };
        accepted.push(fe_zone::centre(site.position(), &zone));
        out.push((site.id, zone));
    }
    out
}

/// How many zones [`candidates`] would place once the automatic ones are gone: the most
/// [`fit`] can keep.
pub fn candidate_count(sites: &[Site<'_>]) -> usize {
    candidates(&placed_only(sites)).len()
}

/// The entries of one `SetFeZones` that replace every automatic zone with `count` of
/// what [`candidates`] places once those zones are gone: `None` for each automatic
/// zone, then the chosen candidates, an anchor that loses one and gains one being a
/// single entry. The candidates kept are spread over the map by farthest-point
/// sampling from the zones the map author placed by hand, or from the edge of the map
/// when there are none. A placed zone, or one systems were linked to, is not touched.
pub fn fit(sites: &[Site<'_>], count: usize) -> Vec<(u32, Option<FeZone>)> {
    let automatic = |site: &Site<'_>| site.zone.is_some() && !site.placed();
    let kept = placed_only(sites);
    let mut entries: Vec<(u32, Option<FeZone>)> = sites
        .iter()
        .filter(|site| automatic(site))
        .map(|site| (site.id, None))
        .collect();
    for (id, zone) in spread(&kept, candidates(&kept), count) {
        match entries.iter_mut().find(|(anchor, _)| *anchor == id) {
            Some(entry) => entry.1 = Some(zone),
            None => entries.push((id, Some(zone))),
        }
    }
    entries.retain(|(id, zone)| {
        let current = sites
            .iter()
            .find(|site| site.id == *id)
            .and_then(|site| site.zone);
        zone.as_ref() != current
    });
    entries
}

fn placed_only<'a>(sites: &[Site<'a>]) -> Vec<Site<'a>> {
    sites
        .iter()
        .map(|site| Site {
            zone: site.zone.filter(|_| site.placed()),
            ..*site
        })
        .collect()
}

/// `count` of `candidates`, in their own order, chosen by farthest-point sampling: the
/// chosen centres start as the placed zones' centres, and each pick is the candidate
/// whose centre lies farthest from the nearest chosen one, the lower anchor id on a
/// tie. With no placed zone the first pick is the candidate farthest from the origin.
fn spread(sites: &[Site<'_>], candidates: Vec<(u32, FeZone)>, count: usize) -> Vec<(u32, FeZone)> {
    if count >= candidates.len() {
        return candidates;
    }
    let mut chosen: Vec<(f64, f64)> = sites.iter().filter_map(Site::centre).collect();
    let centre_of = |id: u32, zone: &FeZone| {
        let site = sites
            .iter()
            .find(|site| site.id == id)
            .expect("a candidate's anchor");
        fe_zone::centre(site.position(), zone)
    };
    let mut remaining: Vec<(u32, (f64, f64))> = candidates
        .iter()
        .map(|(id, zone)| (*id, centre_of(*id, zone)))
        .collect();
    let mut picked: Vec<u32> = Vec::with_capacity(count);
    while picked.len() < count {
        let score = |c: (f64, f64)| {
            if chosen.is_empty() {
                return fe_zone::distance(c, (0.0, 0.0));
            }
            chosen
                .iter()
                .map(|&placed| fe_zone::distance(c, placed))
                .fold(f64::INFINITY, f64::min)
        };
        let mut best: Option<(usize, u32, f64)> = None;
        for (i, &(id, c)) in remaining.iter().enumerate() {
            let s = score(c);
            let better = match best {
                None => true,
                Some((_, best_id, best_score)) => {
                    s > best_score || (s == best_score && id < best_id)
                }
            };
            if better {
                best = Some((i, id, s));
            }
        }
        let (i, id, _) = best.expect("count is below the candidate count");
        chosen.push(remaining.swap_remove(i).1);
        picked.push(id);
    }
    candidates
        .into_iter()
        .filter(|(id, _)| picked.contains(id))
        .collect()
}

fn automatic(direction: FeDirection) -> FeZone {
    FeZone {
        direction,
        kind: FeKind::Random,
        distance: DEFAULT_DISTANCE,
        preferred: false,
        fallback: false,
    }
}
