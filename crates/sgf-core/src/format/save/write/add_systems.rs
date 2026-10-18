//! Adding systems to a save as one undo step: a `Batch` of `AddSystemFromSpec`, the
//! anomalies, dig sites, megastructures and global event targets their layouts' scripts make,
//! and the lanes between them.

use std::collections::BTreeSet;

use crate::and_list;
use crate::format::save::alloc;
use crate::format::save::event_targets;
use crate::format::save::system_spec::{SpecMegastructurePlace, SpecTarget, SystemAdd, SystemSpec};
use crate::format::save::write::add_system::{add_description, body_ids, body_place, check_places};
use crate::format::save::write::nebula::written_literal;
use crate::ops::rules::{Form, check_text, labelled};
use crate::ops::{
    EventTargetOf, LaneEnd, LanePair, NewMegastructure, NewMegastructurePlace, Op, OpError,
    SpecBody, SpecStar,
};
use crate::session::Session;
use crate::{plural, plural_of};

/// The most systems one bulk add writes into a save.
pub const BULK_ADD_CAP: usize = 200;

/// The op that adds `systems` to the save: an [`Op::AddSystemFromSpec`] per system in order,
/// the `j`th taking the next system id plus `j` and each spec's own lanes dropped; then for
/// each system, with `extras`, an [`Op::AddAnomaly`] and an [`Op::AddDigSite`] per one its
/// extras plant, an [`Op::AddMegastructure`] per row they spawn and an [`Op::AddRingWorld`] for
/// their ring world, and whatever `extras` says an [`Op::AddEventTarget`] per target they save
/// whose name the save does not hold yet, the last of a name saved twice; then one
/// [`Op::AddLanePairs`] laying `lanes` when there are any. The new bodies' ids are those the
/// planet table hands out next, in the order the specs list them. All of it is one
/// [`Op::Batch`] described as `description`. Without one it is described by what it adds,
/// and a lone system with nothing beside it is its [`Op::AddSystemFromSpec`] alone. Refused
/// with nothing applied when there are no systems, more than [`BULK_ADD_CAP`], a system
/// nearer than the game spawns one to another or to a new one before it, a lane end that
/// names neither a new system nor one the document holds, or an extra on a body its spec
/// lacks.
pub(crate) fn add_op(
    s: &Session,
    mut systems: Vec<SystemAdd>,
    lanes: &[(LaneEnd, LaneEnd)],
    extras: bool,
    description: Option<String>,
) -> Result<Op, OpError> {
    if systems.is_empty() {
        return Err(OpError::EmptyBatch);
    }
    if systems.len() > BULK_ADD_CAP {
        return Err(OpError::TooManySystems {
            count: systems.len(),
            cap: BULK_ADD_CAP,
        });
    }
    let first = alloc::next_system(&s.doc, &s.graph)?;
    let points: Vec<(f64, f64)> = systems.iter().map(|add| (add.spec.x, add.spec.y)).collect();
    check_places(&s.graph, first, &points)?;
    let id = |end: LaneEnd| match end {
        LaneEnd::New { index } => {
            let id = first.saturating_add(index);
            match usize::try_from(index) {
                Ok(index) if index < systems.len() => Ok(id),
                _ => Err(OpError::UnknownSystem(id)),
            }
        }
        LaneEnd::Held { system } if s.graph.systems.contains_key(&system) => Ok(system),
        LaneEnd::Held { system } => Err(OpError::UnknownSystem(system)),
    };
    let lanes = lanes
        .iter()
        .map(|&(a, b)| {
            Ok(LanePair {
                a: id(a)?,
                b: id(b)?,
                bridge: false,
            })
        })
        .collect::<Result<Vec<_>, OpError>>()?;

    for add in &mut systems {
        add.spec.lanes.clear();
    }
    let planted = planted(s, first, &systems, extras)?;
    let described = description.is_some();
    let description =
        description.unwrap_or_else(|| describe(s, first, &systems, &planted, lanes.len()));
    let mut ops: Vec<Op> = systems
        .into_iter()
        .map(|add| Op::AddSystemFromSpec { spec: add.spec })
        .collect();
    ops.extend(planted);
    if !lanes.is_empty() {
        ops.push(Op::AddLanePairs { lanes });
    }
    if ops.len() == 1 && !described {
        return Ok(ops.remove(0));
    }
    Ok(Op::Batch { description, ops })
}

/// The ops that write each system's extras, the `j`th system taking id `first + j`: its
/// anomalies, dig sites, megastructures and ring world when `extras`, and its event targets but those whose name the
/// save holds, a name saved twice taking the last.
fn planted(
    s: &Session,
    first: u32,
    systems: &[SystemAdd],
    extras: bool,
) -> Result<Vec<Op>, OpError> {
    let any = systems.iter().any(|add| {
        let planted = &add.extras;
        !planted.event_targets.is_empty() || (extras && planted.optional())
    });
    if !any {
        return Ok(Vec::new());
    }
    let specs: Vec<&SystemSpec> = systems.iter().map(|add| &add.spec).collect();
    let ids = body_ids(&s.doc, &specs)?;
    let held: BTreeSet<String> = event_targets::targets(&s.doc)
        .into_iter()
        .map(|(_, target)| target.name)
        .collect();
    let mut ops = Vec::new();
    let mut targets: Vec<Op> = Vec::new();
    for ((add, bodies), system) in systems.iter().zip(&ids).zip(first..) {
        let body = |at: SpecBody| {
            body_place(&add.spec, at)
                .map(|place| bodies[place])
                .ok_or_else(|| OpError::NoSpecBody {
                    system: labelled(&add.spec.name, written_literal(&add.spec.name), system),
                    body: spec_body_named(at),
                })
        };
        for saved in &add.extras.event_targets {
            check_text("an event target name", &saved.name, Form::Bare)?;
        }
        if extras {
            for anomaly in &add.extras.anomalies {
                ops.push(Op::AddAnomaly {
                    body: body(anomaly.body)?,
                    category: anomaly.category.clone(),
                    found_by: None,
                });
            }
            for site in &add.extras.dig_sites {
                ops.push(Op::AddDigSite {
                    body: body(site.body)?,
                    site_type: site.site_type.clone(),
                    difficulty: site.difficulty,
                });
            }
            for row in &add.extras.megastructures {
                let at = match &row.at {
                    SpecMegastructurePlace::Body {
                        body: at,
                        body_flags,
                        star_only,
                    } => NewMegastructurePlace::Body {
                        body: body(*at)?,
                        body_flags: body_flags.clone(),
                        star_only: *star_only,
                    },
                    &SpecMegastructurePlace::Free { x, y } => NewMegastructurePlace::Free { x, y },
                };
                let spec = NewMegastructure {
                    kind: row.kind.clone(),
                    at,
                    ..NewMegastructure::default()
                };
                ops.push(Op::AddMegastructure { system, spec });
            }
            if let Some(ring) = &add.extras.ring_world {
                ops.push(Op::AddRingWorld {
                    system,
                    owner: None,
                    ring: ring.clone(),
                });
            }
        }
        for saved in &add.extras.event_targets {
            if held.contains(&saved.name) {
                continue;
            }
            let target = match saved.target {
                SpecTarget::System => EventTargetOf::System { system },
                SpecTarget::Body(at) => EventTargetOf::Body { body: body(at)? },
            };
            targets
                .retain(|op| !matches!(op, Op::AddEventTarget { name, .. } if *name == saved.name));
            targets.push(Op::AddEventTarget {
                name: saved.name.clone(),
                target,
            });
        }
    }
    ops.extend(targets);
    Ok(ops)
}

/// What the add says in the undo list: "Added Seddom #601 with its anomaly and 1 lane", or
/// "Added 3 systems with their 2 anomalies" for several, naming the anomalies, dig sites,
/// megastructures and ring worlds `planted` writes and counting the `lanes`. A lone system
/// with none of those extras says what its add says, its lanes counted.
fn describe(
    s: &Session,
    first: u32,
    systems: &[SystemAdd],
    planted: &[Op],
    lanes: usize,
) -> String {
    let count = |matches: fn(&Op) -> bool| planted.iter().filter(|op| matches(op)).count();
    let anomalies = count(|op| matches!(op, Op::AddAnomaly { .. }));
    let sites = count(|op| matches!(op, Op::AddDigSite { .. }));
    let rows = count(|op| matches!(op, Op::AddMegastructure { .. }));
    let rings = count(|op| matches!(op, Op::AddRingWorld { .. }));
    let mut parts = Vec::new();
    match anomalies {
        0 => {}
        1 => parts.push("anomaly".to_owned()),
        n => parts.push(plural_of(n, "anomaly", "anomalies")),
    }
    match sites {
        0 => {}
        1 => parts.push("dig site".to_owned()),
        n => parts.push(plural(n, "dig site")),
    }
    match rows {
        0 => {}
        1 => parts.push("megastructure".to_owned()),
        n => parts.push(plural(n, "megastructure")),
    }
    match rings {
        0 => {}
        1 => parts.push("ring world".to_owned()),
        n => parts.push(plural(n, "ring world")),
    }
    if let [one] = systems
        && parts.is_empty()
    {
        return add_description(s, first, &one.spec, lanes);
    }
    if lanes > 0 {
        parts.push(plural(lanes, "lane"));
    }
    let (added, possessive) = match systems {
        [one] => (
            labelled(&one.spec.name, written_literal(&one.spec.name), first),
            "its",
        ),
        many => (plural(many.len(), "system"), "their"),
    };
    match parts.is_empty() {
        true => format!("Added {added}"),
        false => format!("Added {added} with {possessive} {}", and_list(&parts)),
    }
}

/// What the refusal of an extra calls the star `star` of a spec: "the star", or "star 2"
/// for the companion that is its second planet.
fn star_named(star: SpecStar) -> String {
    match star {
        SpecStar::Primary => "the star".to_owned(),
        SpecStar::Companion(index) => format!("star {}", index + 1),
    }
}

/// What the refusal of an extra calls the body `at` of a spec: "moon 3 of planet 2".
fn spec_body_named(at: SpecBody) -> String {
    match at {
        SpecBody::Star => "star".to_owned(),
        SpecBody::Planet { index } => format!("planet {}", index + 1),
        SpecBody::Moon { of, index } => format!("moon {} of planet {}", index + 1, of + 1),
        SpecBody::Satellite { star, index } => {
            format!("planet {} of {}", index + 1, star_named(star))
        }
        SpecBody::SatelliteMoon {
            star,
            satellite,
            index,
        } => format!(
            "moon {} of planet {} of {}",
            index + 1,
            satellite + 1,
            star_named(star)
        ),
    }
}
