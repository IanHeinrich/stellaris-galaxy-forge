//! Paint a Galaxy's fallen empire zones: the star flags on an anchor system that tell
//! the mod where, how far off and which kind of fallen empire to seat.
//!
//! A zone is `set_star_flag = painted_galaxy_fe_spawn` and the flags beside it that
//! share the prefix, all inside the anchor's `effect` block. Reading folds them into a
//! [`FeZone`]; writing turns one back into the flags in the mod's order. A flag the mod
//! does not accept is passed over and the mod's own default stands in for it.
//!
//! A zone is empty space: at game start the mod creates the fallen empire's home system
//! at the zone's centre and its other systems around it, so the ring of
//! [`FE_ZONE_RADIUS`] around the centre must hold no system. [`candidates`] is the
//! mod's own rule for the zones it places by itself, copied so that the two tools
//! agree on a map.

use std::f64::consts::SQRT_2;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::cst::Node;
use crate::projections::galaxy::Galaxy;

pub(crate) const SET_STAR_FLAG: &str = "set_star_flag";
const FLAG: &str = "painted_galaxy_fe_spawn";
const FLAG_PREFIX: &str = "painted_galaxy_fe_spawn_";
const DISTANCE_PREFIX: &str = "distance_";
const PREFERRED: &str = "preferred";
const FALLBACK: &str = "fallback";

/// How far from its centre a zone reaches.
pub const FE_ZONE_RADIUS: f64 = 30.0;
/// The distances the mod accepts between the anchor and the zone's centre.
pub const FE_ZONE_DISTANCES: [u16; 18] = [
    30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200,
];
const DEFAULT_DISTANCE: u16 = 40;
/// How far apart two centres must stand for both rings to be empty.
const ZONE_SPACING: f64 = 2.0 * FE_ZONE_RADIUS;
/// How far from the origin an automatic centre must stand: the mod's core guide plus
/// the radius.
const CORE_CLEARANCE: f64 = 100.0 + FE_ZONE_RADIUS;
/// Where the mod's L-Cluster guide stands and how far an automatic centre keeps from
/// it: the guide's 70 plus the radius.
const L_CLUSTER: (f64, f64) = (-420.0, -420.0);
const L_CLUSTER_CLEARANCE: f64 = 70.0 + FE_ZONE_RADIUS;
/// How far from the origin, on either axis, a centre may lie.
pub const FE_ZONE_EXTENT: f64 = 470.0;

/// Which way from the anchor the zone's centre lies.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum FeDirection {
    E,
    Se,
    S,
    Sw,
    W,
    Nw,
    N,
    Ne,
}

impl FeDirection {
    pub const ALL: [Self; 8] = [
        Self::E,
        Self::Se,
        Self::S,
        Self::Sw,
        Self::W,
        Self::Nw,
        Self::N,
        Self::Ne,
    ];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::E => "e",
            Self::Se => "se",
            Self::S => "s",
            Self::Sw => "sw",
            Self::W => "w",
            Self::Nw => "nw",
            Self::N => "n",
            Self::Ne => "ne",
        }
    }

    pub fn parse(text: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|d| d.as_str() == text)
    }
}

/// Which fallen empire the mod seats in the zone.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum FeKind {
    Random,
    Materialist,
    Spiritualist,
    Xenophobe,
    Xenophile,
    Machine,
    Hive,
}

impl FeKind {
    pub const ALL: [Self; 7] = [
        Self::Random,
        Self::Materialist,
        Self::Spiritualist,
        Self::Xenophobe,
        Self::Xenophile,
        Self::Machine,
        Self::Hive,
    ];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Random => "random",
            Self::Materialist => "materialist",
            Self::Spiritualist => "spiritualist",
            Self::Xenophobe => "xenophobe",
            Self::Xenophile => "xenophile",
            Self::Machine => "machine",
            Self::Hive => "hive",
        }
    }

    pub fn parse(text: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|k| k.as_str() == text)
    }
}

/// The zone one system anchors: where its centre lies from the anchor, who is seated
/// there, and whether the map author placed it by hand (`preferred`) or offered it as a
/// `fallback`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct FeZone {
    pub direction: FeDirection,
    pub kind: FeKind,
    pub distance: u16,
    pub preferred: bool,
    pub fallback: bool,
}

/// Every `set_star_flag` of an `effect` block, in file order.
pub(crate) fn star_flags<'a>(effect: &'a Node, src: &'a [u8]) -> impl Iterator<Item = &'a str> {
    effect
        .find_all(SET_STAR_FLAG, src)
        .filter_map(|flag| flag.scalar_str(src))
}

/// The zone the flags describe, `None` unless `painted_galaxy_fe_spawn` is among them.
/// A direction, kind or distance the mod does not accept is passed over, and the mod's
/// defaults stand in for whatever the flags leave unsaid.
pub fn parse<'a>(flags: impl Iterator<Item = &'a str>) -> Option<FeZone> {
    let mut anchored = false;
    let mut zone = FeZone {
        direction: FeDirection::E,
        kind: FeKind::Random,
        distance: DEFAULT_DISTANCE,
        preferred: false,
        fallback: false,
    };
    for flag in flags {
        if flag == FLAG {
            anchored = true;
            continue;
        }
        let Some(suffix) = flag.strip_prefix(FLAG_PREFIX) else {
            continue;
        };
        if let Some(direction) = FeDirection::parse(suffix) {
            zone.direction = direction;
        } else if let Some(kind) = FeKind::parse(suffix) {
            zone.kind = kind;
        } else if let Some(distance) = suffix.strip_prefix(DISTANCE_PREFIX) {
            if let Ok(distance) = distance.parse()
                && FE_ZONE_DISTANCES.contains(&distance)
            {
                zone.distance = distance;
            }
        } else if suffix == PREFERRED {
            zone.preferred = true;
        } else if suffix == FALLBACK {
            zone.fallback = true;
        }
    }
    anchored.then_some(zone)
}

/// The flags that state `zone`, in the order the mod writes them.
pub fn flags(zone: &FeZone) -> Vec<String> {
    let mut flags = vec![
        FLAG.to_owned(),
        format!("{FLAG_PREFIX}{}", zone.direction.as_str()),
        format!("{FLAG_PREFIX}{}", zone.kind.as_str()),
        format!("{FLAG_PREFIX}{DISTANCE_PREFIX}{}", zone.distance),
    ];
    if zone.preferred {
        flags.push(format!("{FLAG_PREFIX}{PREFERRED}"));
    }
    if zone.fallback {
        flags.push(format!("{FLAG_PREFIX}{FALLBACK}"));
    }
    flags
}

/// The zone's centre, `anchor` being the anchor's `position` as the file writes it.
/// East lies at negative x: the mod's canvas mirrors the game's x axis, and the flags
/// name the canvas side.
pub fn centre(anchor: (f64, f64), zone: &FeZone) -> (f64, f64) {
    let d = f64::from(zone.distance);
    let k = d / SQRT_2;
    let (dx, dy) = match zone.direction {
        FeDirection::E => (-d, 0.0),
        FeDirection::Se => (-k, k),
        FeDirection::S => (0.0, d),
        FeDirection::Sw => (k, k),
        FeDirection::W => (d, 0.0),
        FeDirection::Nw => (k, -k),
        FeDirection::N => (0.0, -d),
        FeDirection::Ne => (-k, -k),
    };
    (anchor.0 + dx, anchor.1 + dy)
}

/// Whether a star flag is part of a zone. The mod's custom connection flags share the
/// `painted_galaxy_fe_` start and are not.
pub fn is_zone_flag(flag: &str) -> bool {
    flag == FLAG || flag.starts_with(FLAG_PREFIX)
}

/// Whether `point` lies inside the ring around `centre`, which the mod needs empty.
pub fn inside(centre: (f64, f64), point: (f64, f64)) -> bool {
    distance(centre, point) < FE_ZONE_RADIUS
}

/// Whether two rings share any space.
pub fn overlaps(a: (f64, f64), b: (f64, f64)) -> bool {
    distance(a, b) < ZONE_SPACING
}

/// Whether a centre lies beyond the canvas the mod paints on.
pub fn is_off_map(centre: (f64, f64)) -> bool {
    centre.0.abs() > FE_ZONE_EXTENT || centre.1.abs() > FE_ZONE_EXTENT
}

pub fn distance(a: (f64, f64), b: (f64, f64)) -> f64 {
    (a.0 - b.0).hypot(a.1 - b.1)
}

/// The zone flagged `kind` and `preferred` whose centre lies nearest `point`, over every
/// anchor of `anchors`, every direction and every distance the mod accepts: its ring
/// holds none of `sites`, stands its own width from every centre in `placed` and lies on
/// the map. An anchor that already carries a zone is passed over. `None` when no such
/// zone exists.
pub fn nearest_zone(
    point: (f64, f64),
    kind: FeKind,
    anchors: &[Site<'_>],
    sites: &[Site<'_>],
    placed: &[(f64, f64)],
) -> Option<(u32, FeZone)> {
    let mut by_reach: Vec<&Site<'_>> = anchors.iter().filter(|site| site.zone.is_none()).collect();
    by_reach.sort_by(|a, b| {
        distance(a.position(), point)
            .total_cmp(&distance(b.position(), point))
            .then(a.id.cmp(&b.id))
    });
    let farthest = f64::from(*FE_ZONE_DISTANCES.last().expect("distances"));
    let mut best: Option<(f64, u32, FeZone)> = None;
    for anchor in by_reach {
        let reach = distance(anchor.position(), point) - farthest;
        if best.as_ref().is_some_and(|(near, _, _)| reach >= *near) {
            break;
        }
        for &d in &FE_ZONE_DISTANCES {
            for direction in FeDirection::ALL {
                let zone = FeZone {
                    direction,
                    kind,
                    distance: d,
                    preferred: true,
                    fallback: false,
                };
                let c = centre(anchor.position(), &zone);
                let off = distance(c, point);
                if best.as_ref().is_some_and(|(near, _, _)| off >= *near) {
                    continue;
                }
                let clear = !is_off_map(c)
                    && !sites.iter().any(|other| inside(c, other.position()))
                    && !placed.iter().any(|&other| overlaps(c, other));
                if clear {
                    best = Some((off, anchor.id, zone));
                }
            }
        }
    }
    best.map(|(_, id, zone)| (id, zone))
}

/// A system as the automatic rule sees it: where it stands, the zone it anchors and
/// whether it takes custom connections for that zone.
#[derive(Debug, Clone, Copy)]
pub struct Site<'a> {
    pub id: u32,
    pub x: f64,
    pub y: f64,
    pub zone: Option<&'a FeZone>,
    pub linked: bool,
}

impl Site<'_> {
    fn position(&self) -> (f64, f64) {
        (self.x, self.y)
    }

    fn centre(&self) -> Option<(f64, f64)> {
        self.zone.map(|zone| centre(self.position(), zone))
    }

    /// Whether the zone is the map author's to keep: placed by hand, or one systems
    /// were linked to.
    fn placed(&self) -> bool {
        self.zone.is_some_and(|zone| zone.preferred || self.linked)
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
            let c = centre(site.position(), &zone);
            let clear = distance(c, (0.0, 0.0)) >= CORE_CLEARANCE
                && distance(c, L_CLUSTER) >= L_CLUSTER_CLEARANCE
                && !is_off_map(c)
                && !sites.iter().any(|other| inside(c, other.position()))
                && !accepted.iter().any(|&placed| overlaps(c, placed));
            clear.then_some(zone)
        }) else {
            continue;
        };
        accepted.push(centre(site.position(), &zone));
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
        centre(site.position(), zone)
    };
    let mut remaining: Vec<(u32, (f64, f64))> = candidates
        .iter()
        .map(|(id, zone)| (*id, centre_of(*id, zone)))
        .collect();
    let mut picked: Vec<u32> = Vec::with_capacity(count);
    while picked.len() < count {
        let score = |c: (f64, f64)| {
            if chosen.is_empty() {
                return distance(c, (0.0, 0.0));
            }
            chosen
                .iter()
                .map(|&placed| distance(c, placed))
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

#[cfg(test)]
mod tests {
    use super::*;

    fn site(id: u32, x: f64, y: f64) -> Site<'static> {
        Site {
            id,
            x,
            y,
            zone: None,
            linked: false,
        }
    }

    #[test]
    fn the_nearest_zone_to_a_point_is_the_clear_grid_position_closest_to_it() {
        let sites = [site(1, 0.0, 0.0), site(2, 100.0, 0.0), site(3, 0.0, 100.0)];
        let (anchor, zone) = nearest_zone((-42.0, 0.0), FeKind::Hive, &sites, &sites, &[])
            .expect("a clear position within reach");
        assert_eq!(anchor, 1);
        assert_eq!(
            zone,
            FeZone {
                direction: FeDirection::E,
                kind: FeKind::Hive,
                distance: 40,
                preferred: true,
                fallback: false,
            }
        );
        assert_eq!(centre((0.0, 0.0), &zone), (-40.0, 0.0));

        let (anchor, zone) = nearest_zone((100.0, 40.0), FeKind::Random, &sites, &sites, &[])
            .expect("a clear position within reach");
        assert_eq!(
            (anchor, zone.direction, zone.distance),
            (2, FeDirection::S, 40)
        );

        let blocked = nearest_zone(
            (100.0, 40.0),
            FeKind::Random,
            &sites,
            &sites,
            &[(100.0, 40.0)],
        )
        .expect("the next position out");
        assert_ne!(centre((100.0, 0.0), &blocked.1), (100.0, 40.0));
        assert!(!overlaps(
            centre(sites[blocked.0 as usize - 1].position(), &blocked.1),
            (100.0, 40.0)
        ));

        let far = [site(9, 460.0, 460.0)];
        let (_, zone) = nearest_zone((470.0, 470.0), FeKind::Random, &far, &far, &[])
            .expect("a centre on the map");
        assert!(!is_off_map(centre((460.0, 460.0), &zone)));
    }
}
