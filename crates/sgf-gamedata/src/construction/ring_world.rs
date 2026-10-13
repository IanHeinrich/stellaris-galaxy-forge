//! The ring world a megastructure type's completion lays out, read from its [`layout`]: a
//! type whose completion spawns rows round the system's centre, each of which is taken to
//! the stage the player picks for its quadrant. The editor adds it whole, with
//! [`sgf_core::ops::Op::AddRingWorld`].

use serde::{Deserialize, Serialize};
use sgf_core::ops::{
    NewPlanet, NewRingWorld, RingQuadrant, RingRow, RingSegment, RingVariable, TimedModifier,
};
use sgf_core::views::OrbitPlacement;
use ts_rs::TS;

use super::lasting;
use super::layout::{self, Around, LaidPlanet, LaidRow, Plan, SectionStage, SystemLayout};
use crate::GameData;
use crate::registries::megastructures::{MegastructureDef, is_ruin};

/// The name the game's initializers give a damaged segment, which
/// `set_ruined_megastructure` spawns with none of its own.
const DAMAGED_NAME: &str = "NAME_Ring_Section";

/// The stage a quadrant of a ring world is added at.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum RingStage {
    /// Built: its tech, seam and habitable sections.
    Finished,
    /// A frame section waiting to be built.
    Frame,
    /// A ruined section.
    Ruined,
    /// Ruined as the game's `set_ruined_megastructure` ruins one: damaged sections.
    Damaged,
    /// A ruin built again: its sections laid out mirrored.
    Restored,
}

impl RingStage {
    fn section(self) -> SectionStage {
        match self {
            Self::Finished => SectionStage::Built,
            Self::Frame => SectionStage::Spawned,
            Self::Ruined => SectionStage::Ruined,
            Self::Damaged => SectionStage::Damaged,
            Self::Restored => SectionStage::Restored,
        }
    }
}

/// The ring world of type `key`'s chain, any stage of it, its site, its frame, a quadrant or
/// a ruin, with its quadrants at `stages` in the order they are spawned and its models drawn
/// in `culture`: what finishing the stage that spawns the quadrants leaves round a star of a
/// system that holds the flags `held_flags` already, whose habitable sections are named on
/// from those a ring standing there took.
/// Refused, with the reason, when no type joined to `key` spawns as many rows round the
/// system's centre as `stages` holds, or the ring leaves something the op does not write:
/// its own row, a star flag naming an id, a planet the walk cannot size, name or give the
/// model its spawn sets, a stage that leaves neither a row nor planets, a ruined or restored
/// quadrant of a chain with no ruined type, and a damaged one the game's ruin leaves as it
/// is.
pub fn ring_world(
    gd: &GameData,
    key: &str,
    stages: &[RingStage],
    culture: Option<&str>,
    held_flags: &[String],
) -> Result<NewRingWorld, String> {
    let plan = Plan {
        on_star: true,
        sections: stages.iter().map(|stage| stage.section()).collect(),
        culture: culture.map(str::to_owned),
        held_flags: held_flags.to_vec(),
    };
    let mut refused = None;
    for def in joined(gd, key)
        .into_iter()
        .filter(|def| def.completes.spawns_rows > 1)
    {
        let Some(laid) = layout::lay_out(gd, &def.key, &plan) else {
            continue;
        };
        match of_layout(&laid, stages, culture) {
            Ok(ring) => return Ok(ring),
            Err(Some(reason)) => refused = refused.or(Some(reason)),
            Err(None) => {}
        }
    }
    Err(refused.unwrap_or_else(|| {
        format!(
            "no stage of its chain lays out a ring world of {} quadrants",
            stages.len()
        )
    }))
}

/// How many quadrants the ring of `key`'s chain has: the rows the stage that spawns them
/// spawns. `None` when no type joined to `key` spawns more than one row.
pub fn quadrants(gd: &GameData, key: &str) -> Option<usize> {
    joined(gd, key)
        .into_iter()
        .map(|def| def.completes.spawns_rows)
        .filter(|&rows| rows > 1)
        .max()
}

/// Every type joined to `key`, itself first: by `upgrade_from` either way, by a type its
/// completion spawns either way, and by being a variant of one.
fn joined<'g>(gd: &'g GameData, key: &str) -> Vec<&'g MegastructureDef> {
    let Some(first) = gd.megastructures.get(key) else {
        return Vec::new();
    };
    let mut found = vec![first];
    let mut next = 0;
    while let Some(def) = found.get(next).copied() {
        next += 1;
        let linked = gd.megastructures.iter().filter(|other| {
            def.upgrade_from.contains(&other.key)
                || other.upgrade_from.contains(&def.key)
                || def.completes.spawned.contains(&other.key)
                || other.completes.spawned.contains(&def.key)
                || def.variant_of.as_ref() == Some(&other.key)
                || other.variant_of.as_ref() == Some(&def.key)
        });
        for other in linked {
            if !found.iter().any(|seen| seen.key == other.key) {
                found.push(other);
            }
        }
    }
    found
}

/// The ring `laid` is, or why it cannot be written: `None` when it is no ring of
/// `stages.len()` quadrants round the system's centre.
fn of_layout(
    laid: &SystemLayout,
    stages: &[RingStage],
    culture: Option<&str>,
) -> Result<NewRingWorld, Option<String>> {
    let ring = !laid.sections.is_empty()
        && laid.sections.len() == stages.len()
        && laid.sections.iter().all(|s| s.at.around == Around::Centre);
    if !ring {
        return Err(None);
    }
    if let Some(row) = &laid.row {
        return Err(Some(format!(
            "its own {} row stays standing, which Galaxy Forge does not write with a ring",
            row.kind
        )));
    }
    if let Some(flag) = laid.host_flags.iter().find(|flag| flag.id_of.is_some()) {
        return Err(Some(format!(
            "it gives the star the flag {} with an id, which Galaxy Forge does not write",
            flag.flag
        )));
    }
    let mut quadrants = Vec::with_capacity(stages.len());
    for (index, (section, &stage)) in laid.sections.iter().zip(stages).enumerate() {
        let segments: Vec<&LaidPlanet> = laid
            .planets
            .iter()
            .filter(|planet| planet.section == Some(index))
            .collect();
        let quadrant = match (stage, &section.row) {
            (RingStage::Frame, Some(row)) if segments.is_empty() => RingQuadrant::Frame {
                row: ring_row(row, culture),
            },
            (RingStage::Ruined, Some(row)) if segments.is_empty() && is_ruin(&row.kind) => {
                RingQuadrant::Ruined {
                    row: ring_row(row, culture),
                }
            }
            (RingStage::Ruined | RingStage::Restored, Some(row)) if segments.is_empty() => {
                return Err(Some(format!(
                    "its chain has no ruined type to stand in place of its {} row",
                    row.kind
                )));
            }
            (RingStage::Damaged, Some(row)) if segments.is_empty() => {
                return Err(Some(format!(
                    "the game's set_ruined_megastructure leaves its {} row as it is",
                    row.kind
                )));
            }
            (RingStage::Finished | RingStage::Restored | RingStage::Damaged, None)
                if !segments.is_empty() =>
            {
                let segments = segments
                    .into_iter()
                    .map(|planet| segment(planet, culture))
                    .collect::<Result<Vec<_>, String>>()
                    .map_err(Some)?;
                match stage {
                    RingStage::Finished => RingQuadrant::Finished { segments },
                    RingStage::Restored => RingQuadrant::Restored { segments },
                    _ => RingQuadrant::Damaged { segments },
                }
            }
            _ => {
                return Err(Some(format!(
                    "quadrant {} at its {stage:?} stage leaves neither one row nor its planets",
                    index + 1
                )));
            }
        };
        quadrants.push(quadrant);
    }
    Ok(NewRingWorld {
        quadrants,
        system_flags: laid.system_flags.clone(),
        system_variables: laid
            .system_variables
            .iter()
            .map(|(name, value)| RingVariable {
                name: name.clone(),
                value: *value,
            })
            .collect(),
        star_flags: laid
            .host_flags
            .iter()
            .map(|flag| flag.flag.clone())
            .collect(),
    })
}

fn ring_row(row: &LaidRow, culture: Option<&str>) -> RingRow {
    RingRow {
        kind: row.kind.clone(),
        at: OrbitPlacement {
            radius: row.at.distance,
            angle: row.at.save_angle(),
        },
        name: row.name.clone(),
        owned: row.owned,
        culture: row
            .culture
            .clone()
            .or_else(|| culture.filter(|_| row.cultured).map(str::to_owned)),
    }
}

fn segment(planet: &LaidPlanet, culture: Option<&str>) -> Result<RingSegment, String> {
    let class = &planet.class;
    if planet.at.around != Around::Centre {
        return Err(format!(
            "its {class} orbits a body, not the system's centre"
        ));
    }
    if let Some(flag) = planet.flags.iter().find(|f| f.id_of.is_some()) {
        return Err(format!(
            "its {class} takes the flag {} with an id, which Galaxy Forge does not write",
            flag.flag
        ));
    }
    if planet.model.is_none() && !planet.unfollowed.is_empty() {
        return Err(format!(
            "the model of its {class} hangs on what Galaxy Forge cannot follow: {}",
            planet.unfollowed.join("; ")
        ));
    }
    let name = match &planet.name {
        Some(name) if name.variables.is_empty() => name.key.clone(),
        Some(name) => {
            return Err(format!(
                "the name of its {class}, {}, is filled in when it is built",
                name.key
            ));
        }
        None => DAMAGED_NAME.to_owned(),
    };
    let model = planet
        .model
        .as_ref()
        .and_then(|model| match (model.cultured, culture) {
            (false, _) => Some(model.entity.clone()),
            (true, Some(culture)) => Some(format!("{culture}_{}", model.entity)),
            (true, None) => None,
        });
    Ok(RingSegment {
        planet: NewPlanet {
            class: class.clone(),
            size: planet
                .size
                .ok_or_else(|| format!("the game rolls the size of its {class}"))?,
            at: OrbitPlacement {
                radius: planet.at.distance,
                angle: planet.at.save_angle(),
            },
            name,
            model,
            flags: planet.flags.iter().map(|flag| flag.flag.clone()).collect(),
        },
        megastructure_icon: planet.megastructure_icon,
        modifiers: planet
            .modifiers
            .iter()
            .map(|(modifier, days)| {
                let days = lasting(*days).ok_or_else(|| {
                    format!("its {class} takes modifier {modifier} for {days} days, which Galaxy Forge does not write")
                })?;
                Ok(TimedModifier {
                    modifier: modifier.clone(),
                    days,
                })
            })
            .collect::<Result<_, String>>()?,
    })
}
