//! `ReplaceSaveSystem`, for the systems [`super::add_system`] wrote since the file was
//! opened, in two steps. The first takes the old bodies out as a removal does, which
//! frees their slots and asteroid names and uncounts its layout. The second writes the new
//! bodies as an add does, taking the lowest free slots, counts the new layout, and
//! rewrites in place only what the spec owns in the system's entry: its name, `planet=`
//! lines, star class, belts, flags, initializer and radii. Everything else stays as it
//! stands, its position, lanes and what a nebula gave it among them, with its cloud moved
//! beside the new star and retyped for its class.

use std::collections::BTreeSet;

use crate::Span;
use crate::cst::Node;
use crate::emit::coord;
use crate::emit::system::{belts_block, flags_block, planet_lines};
use crate::format::save::check_version;
use crate::format::save::read_spec::spec_of;
use crate::format::save::system_spec::{SystemSpec, polar};
use crate::format::save::write::add_system::{
    self, Written, bodies, check_capped, check_contents, count_layout, flag_date, write_bodies,
};
use crate::format::save::write::footprint::Footprints;
use crate::format::save::write::remove_system::{
    check_added, erase_bodies, return_asteroid_names, uncount,
};
use crate::format::save::write::rename_system::swap_name;
use crate::keys;
use crate::ops::rules::quoted;
use crate::ops::{Edit, Op, OpError, Plan, Planned};
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
    let flag_date = flag_date(&s.doc, spec)?;
    respec(plan.edit(&s.doc, id)?, spec, &written, &flag_date)?;
    if spec.name != system.name.key {
        swap_name(plan, s, id, &system.name.key, &spec.name)?;
    }
    count_layout(plan, &s.doc, spec)?;
    if check_version(&s.doc).is_ok() {
        let mut footprints = Footprints::new(&s.doc, &s.graph);
        let star = (polar(0.0, 0.0, &spec.star), f64::from(spec.star.size));
        footprints.restar(plan, id, star, &spec.star_class)?;
        footprints.finish(plan)?;
    }
    Ok(Planned {
        description: String::new(),
        inverse: Op::RemoveSystem { id },
    })
}

/// Write what the spec owns into the system's entry where it stands: the name, the
/// `planet=` lines where the old ones stood, the star class, initializer and radii, and
/// the belts and flags blocks, each written where the old one stood, else before the
/// flags or the initializer, as an add writes them.
fn respec(
    edit: &mut Edit,
    spec: &SystemSpec,
    written: &Written,
    flag_date: &str,
) -> Result<(), OpError> {
    let entity = edit.entity()?.clone();
    let span_of = |key: &str| entity.find(key, &edit.buf).map(Node::span);
    let planets: Vec<Span> = entity
        .find_all(keys::PLANET, &edit.buf)
        .map(Node::span)
        .collect();
    let first = *planets
        .first()
        .ok_or_else(|| edit.parse_error(0, "the system lists no bodies"))?;
    let initializer = span_of(keys::INITIALIZER)
        .ok_or_else(|| edit.parse_error(0, "the system has no initializer"))?;
    let (belts, flags) = (span_of(keys::ASTEROID_BELTS), span_of(keys::FLAGS));
    for span in planets.iter().chain(&belts).chain(&flags) {
        edit.require_alone_on_line(*span, "a statement a reroll rewrites")?;
    }

    edit.set_scalar(&[keys::NAME, keys::KEY], quoted(&spec.name))?;
    let indent = edit.indent(first.start);
    edit.insert(
        edit.line_start(first.start),
        planet_lines(&indent, &written.ids),
    );
    for span in planets {
        edit.remove_lines(span);
    }
    edit.set_scalar(&[keys::STAR_CLASS], quoted(&spec.star_class))?;
    let belt_list = add_system::belts(spec);
    let belts_text = |indent: &[u8]| belts_block(indent, &belt_list);
    rewrite_block(
        edit,
        belts,
        flags.unwrap_or(initializer),
        !spec.belts.is_empty(),
        belts_text,
    );
    let flags_text = |indent: &[u8]| flags_block(indent, &spec.flags, flag_date);
    rewrite_block(edit, flags, initializer, !spec.flags.is_empty(), flags_text);
    edit.set_scalar(&[keys::INITIALIZER], quoted(&spec.initializer))?;
    edit.set_scalar(&[keys::INNER_RADIUS], coord(written.inner_radius))?;
    edit.set_scalar(&[keys::OUTER_RADIUS], coord(written.outer_radius()))
}

/// Write the block `text` gives where `block` stands, else before the statement at
/// `before`, when `wanted`; take `block` out either way.
fn rewrite_block(
    edit: &mut Edit,
    block: Option<Span>,
    before: Span,
    wanted: bool,
    text: impl Fn(&[u8]) -> Vec<u8>,
) {
    let at = block.unwrap_or(before);
    if wanted {
        let indent = edit.indent(at.start);
        edit.insert(edit.line_start(at.start), text(&indent));
    }
    if let Some(block) = block {
        edit.remove_lines(block);
    }
}
