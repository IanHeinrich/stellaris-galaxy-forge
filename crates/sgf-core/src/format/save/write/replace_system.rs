//! `ReplaceSaveSystem`, for the systems [`super::add_system`] wrote since the file was
//! opened, in two steps. The first takes the old bodies out as a removal does, which
//! frees their slots and asteroid names and uncounts its layout. The second writes the new
//! bodies as an add does, taking the lowest free slots, counts the new layout, and writes
//! the system's entry again around the coordinate and hyperlane blocks it had, so its
//! position and lanes stay. The `ambient_object` list and `timed_modifier` a nebula gave
//! it stay too, with its cloud moved beside the new star and retyped for its class.

use std::collections::BTreeSet;

use crate::cst;
use crate::format::save::system_spec::SystemSpec;
use crate::format::save::write::add_system::{
    bodies, check_capped, check_contents, count_layout, polar, system_text, write_bodies,
};
use crate::format::save::write::footprint::Footprints;
use crate::format::save::write::remove_system::{
    check_added, erase_bodies, return_asteroid_names, spec_of, uncount,
};
use crate::format::save::write::rename_system::swap_name;
use crate::keys;
use crate::ops::{Op, OpError, Plan, Planned, Subject};
use crate::session::Session;

pub(crate) fn plan_strip(
    plan: &mut Plan,
    s: &Session,
    id: u32,
    spec: &SystemSpec,
) -> Result<Planned, OpError> {
    check_added(s, id)?;
    check_contents(spec)?;
    check_capped(s, spec, Some(id))?;
    let system = s.graph.systems.get(&id).ok_or(OpError::UnknownSystem(id))?;
    let mut lanes: Vec<u32> = Vec::new();
    for lane in &system.lanes {
        if !lanes.contains(&lane.to) {
            lanes.push(lane.to);
        }
    }
    let inverse = Op::ReplaceSaveSystem {
        system: id,
        spec: spec_of(s, id, lanes)?,
    };
    let ids = BTreeSet::from([id]);
    erase_bodies(plan, &s.doc, &ids)?;
    return_asteroid_names(plan, s, &ids)?;
    uncount(plan, s, &ids)?;

    let mut became = Vec::new();
    if spec.name != system.name.key {
        became.push(spec.name.as_str());
    }
    if spec.star_class != system.star_class {
        became.push(spec.star_class.as_str());
    }
    let became = match became.is_empty() {
        true => String::new(),
        false => format!(" as {}", became.join(", ")),
    };
    let count = 1 + spec
        .planets
        .iter()
        .map(|planet| 1 + planet.moons.len())
        .sum::<usize>();
    Ok(Planned {
        description: format!(
            "Rolled {} (#{id}) again{became}, with {}",
            system.name.key,
            bodies(spec, count)
        ),
        inverse,
    })
}

pub(crate) fn plan_fill(
    plan: &mut Plan,
    s: &Session,
    id: u32,
    spec: &SystemSpec,
) -> Result<Planned, OpError> {
    let system = s.graph.systems.get(&id).ok_or(OpError::UnknownSystem(id))?;
    let written = write_bodies(plan, s, id, spec)?;
    let edit = plan.edit(&s.doc, id)?;
    let entity = edit.entity()?.clone();
    let coordinate = entity
        .find(keys::COORDINATE, &edit.buf)
        .ok_or_else(|| edit.parse_error(0, "the system has no coordinate"))?
        .span();
    let lines = |key: &str| {
        entity.find(key, &edit.buf).map(|block| {
            let span = block.span();
            edit.buf[edit.line_start(span.start)..edit.line_end(span.end)].to_vec()
        })
    };
    let kept = Kept {
        lanes: lines(keys::HYPERLANE),
        ambient: lines(keys::AMBIENT_OBJECT),
        modifiers: lines(keys::TIMED_MODIFIER),
    };
    let indent = edit.indent(entity.span().start);
    let text = system_text(
        &s.doc,
        &indent,
        id,
        (system.x, system.y),
        spec,
        &written,
        &[],
    )?;
    let mut text = transplant(id, &text, coordinate.slice(&edit.buf), &kept)?;
    text.pop();
    text.drain(..indent.len());
    edit.splices.push((entity.span().range(), text));
    if spec.name != system.name.key {
        swap_name(plan, s, id, &system.name.key, &spec.name)?;
    }
    count_layout(plan, &s.doc, spec)?;
    if let Some(mut footprints) = Footprints::new(&s.doc, &s.graph) {
        let star = (polar(0.0, 0.0, &spec.star), f64::from(spec.star.size));
        footprints.restar(plan, id, star, &spec.star_class)?;
        footprints.finish(plan)?;
    }
    Ok(Planned {
        description: String::new(),
        inverse: Op::RemoveSystem { id },
    })
}

/// The lines of the blocks a system's entry keeps through a reroll.
struct Kept {
    lanes: Option<Vec<u8>>,
    ambient: Option<Vec<u8>>,
    modifiers: Option<Vec<u8>>,
}

/// `text`, a system entry as written from its spec, with `coordinate` in place of its
/// coordinate block, the kept `ambient_object` list before its star class, the kept
/// hyperlane block after it and the kept `timed_modifier` after its `index`.
fn transplant(id: u32, text: &[u8], coordinate: &[u8], kept: &Kept) -> Result<Vec<u8>, OpError> {
    let error = |reason: &str| Subject::System(id).parse_error(0, reason);
    let root =
        cst::parse(text, 0).map_err(|e| Subject::System(id).parse_error(e.offset, e.reason))?;
    let entity = root
        .children()
        .first()
        .ok_or_else(|| error("empty entry"))?;
    let at = entity
        .find(keys::COORDINATE, text)
        .ok_or_else(|| error("no coordinate written"))?
        .span();
    let star_class = entity
        .find(keys::STAR_CLASS, text)
        .ok_or_else(|| error("no star class written"))?
        .span();
    let index = entity
        .find(keys::INDEX, text)
        .ok_or_else(|| error("no index written"))?
        .span();
    let before = cst::line_start(text, star_class.start);
    let after = cst::line_end(text, star_class.end);
    let after_index = cst::line_end(text, index.end);
    let kept_lines = |lines: &Option<Vec<u8>>| lines.clone().unwrap_or_default();
    Ok([
        &text[..at.start],
        coordinate,
        &text[at.end..before],
        &kept_lines(&kept.ambient),
        &text[before..after],
        &kept_lines(&kept.lanes),
        &text[after..after_index],
        &kept_lines(&kept.modifiers),
        &text[after_index..],
    ]
    .concat())
}
