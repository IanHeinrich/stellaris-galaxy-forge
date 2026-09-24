//! `ReplaceSaveSystem`, for the systems [`super::add_system`] wrote since the file was
//! opened, in two steps. The first takes the old bodies out as a removal does, which
//! frees their slots and asteroid names. The second writes the new bodies as an add
//! does, taking the lowest free slots, and writes the system's entry again around the
//! coordinate and hyperlane blocks it had, so its position and lanes stay.

use std::collections::BTreeSet;

use crate::cst;
use crate::format::save::system_spec::SystemSpec;
use crate::format::save::write::add_system::{bodies, check_contents, system_text, write_bodies};
use crate::format::save::write::remove_system::{
    check_added, erase_bodies, return_asteroid_names, spec_of,
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
    let lanes = entity.find(keys::HYPERLANE, &edit.buf).map(|block| {
        let span = block.span();
        edit.buf[edit.line_start(span.start)..edit.line_end(span.end)].to_vec()
    });
    let indent = edit.indent(entity.span().start);
    let text = system_text(&indent, id, (system.x, system.y), spec, &written, &[]);
    let mut text = transplant(id, &text, coordinate.slice(&edit.buf), lanes.as_deref())?;
    text.pop();
    text.drain(..indent.len());
    edit.splices.push((entity.span().range(), text));
    if spec.name != system.name.key {
        swap_name(plan, s, id, &system.name.key, &spec.name)?;
    }
    Ok(Planned {
        description: String::new(),
        inverse: Op::RemoveSystem { id },
    })
}

/// `text`, a system entry as written from its spec, with `coordinate` in place of its
/// coordinate block and the lines of `lanes`, its hyperlane block, after its star class.
fn transplant(
    id: u32,
    text: &[u8],
    coordinate: &[u8],
    lanes: Option<&[u8]>,
) -> Result<Vec<u8>, OpError> {
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
    let after = cst::line_end(text, star_class.end);
    Ok([
        &text[..at.start],
        coordinate,
        &text[at.end..after],
        lanes.unwrap_or_default(),
        &text[after..],
    ]
    .concat())
}
