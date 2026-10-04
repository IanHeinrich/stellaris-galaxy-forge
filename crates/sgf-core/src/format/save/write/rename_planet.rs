//! `RenameSavePlanet`: a save body's `name`, and the copy of it its moons hold as the
//! value of a `PARENT` variable. The game writes a moon's name as `SUBPLANET_NAME_FORMAT`
//! over its planet's whole name, so a moon of a renamed planet would still read the old
//! one. A moon whose copy already differs from its planet's name keeps it.

use std::collections::BTreeSet;

use crate::Span;
use crate::cst::{self, Node};
use crate::document::Document;
use crate::emit::{Lines, quoted};
use crate::format::save::read_spec::bodies;
use crate::format::save::write::add_system::PARENT_VAR;
use crate::format::save::write::move_planet::is_star_class;
use crate::format::save::write::planet_entry::PlanetEntry;
use crate::format::save::{planet_entity, planet_system};
use crate::keys;
use crate::ops::rules::check_name;
use crate::ops::{Op, OpError, Plan, Planned};
use crate::projections::name::{NameTemplate, variable_values};
use crate::projections::read;
use crate::session::Session;

pub(crate) fn plan_rename(
    plan: &mut Plan,
    s: &Session,
    id: u32,
    name: &str,
    block: Option<&str>,
) -> Result<Planned, OpError> {
    let new = match block {
        Some(block) => Block::parse(block)?,
        None => {
            check_name(name)?;
            Block::literal(name)
        }
    };
    let PlanetEntry { node, src, system } = PlanetEntry::open(s, id)?;
    let primary = bodies(&s.doc, system)?.first() == Some(&id);
    if primary || is_star_class(&read::text(&node, keys::PLANET_CLASS, src)) {
        return Err(OpError::StarNotRenamed(id));
    }
    let moons = read::ids(&node, keys::MOONS, src);

    let edit = plan.edit_planet(&s.doc, id, system)?;
    let entity = edit.entity()?;
    let named = entity
        .find(keys::NAME, &edit.buf)
        .ok_or_else(|| edit.parse_error(entity.span().start, "the planet has no name"))?;
    let value = named.value_span();
    let old = NameTemplate::parse(named, &edit.buf);
    let old_text = edit.text(value).to_owned();
    let written = new.at(&edit.indent(value.start));
    if written == old_text {
        return Err(OpError::PlanetNameUnchanged(id, name.to_owned()));
    }
    edit.replace_span(value, written);

    rename_copies(plan, &s.doc, id, moons, &old, &new)?;
    let description = match block {
        None => format!("Renamed planet #{id} to {name}"),
        Some(_) => format!("Put back the name of planet #{id}"),
    };
    Ok(Planned {
        description,
        inverse: Op::RenameSavePlanet {
            planet: id,
            name: if old.literal {
                old.key.clone()
            } else {
                old.stand_in()
            },
            block: Some(old_text),
        },
    })
}

/// Write `new` for every copy of `old` the moons of planet `id` hold, and their moons.
fn rename_copies(
    plan: &mut Plan,
    doc: &Document,
    id: u32,
    moons: Vec<u32>,
    old: &NameTemplate,
    new: &Block,
) -> Result<(), OpError> {
    let mut seen = BTreeSet::from([id]);
    let mut queue = moons;
    while let Some(moon) = queue.pop() {
        if !seen.insert(moon) {
            continue;
        }
        let (node, src) = match planet_entity(doc, moon) {
            Ok(found) => found,
            // The game leaves a removed moon's id in its planet's `moons`.
            Err(OpError::UnknownPlanet(_)) => continue,
            Err(e) => return Err(e),
        };
        let system = planet_system(&node, src, moon)?;
        queue.extend(read::ids(&node, keys::MOONS, src));
        let edit = plan.edit_planet(doc, moon, system)?;
        let mut copies = Vec::new();
        if let Some(name) = edit.entity()?.find(keys::NAME, &edit.buf) {
            parent_copies(name, &edit.buf, old, &mut copies);
        }
        for span in copies {
            let text = new.at(&edit.indent(span.start));
            edit.replace_span(span, text);
        }
    }
    Ok(())
}

/// The value of every `PARENT` variable inside `name`, at any depth, that is `old`.
fn parent_copies(name: &Node, src: &[u8], old: &NameTemplate, out: &mut Vec<Span>) {
    let copies = variable_values(name, src, &[PARENT_VAR], &|value| {
        NameTemplate::parse(value, src) == *old
    });
    out.extend(copies.into_iter().map(Node::value_span));
}

/// A name's `{ … }` value as text, its closing brace's line indented as the block stands.
struct Block(String);

impl Block {
    /// `{ key="<name>" literal=yes }` in the game's multi-line shape.
    fn literal(name: &str) -> Self {
        let mut w = Lines::new(b"");
        w.line(0, "{");
        w.pair(1, keys::KEY, &quoted(name));
        w.pair(1, keys::LITERAL, "yes");
        w.close(0);
        let text = String::from_utf8_lossy(&w.into_bytes()).into_owned();
        Self(text.trim_end_matches('\n').to_owned())
    }

    /// A name value given whole, refused unless it reads as one block.
    fn parse(block: &str) -> Result<Self, OpError> {
        let invalid = || OpError::InvalidText {
            what: "a name block",
            text: block.to_owned(),
        };
        let statement = format!("{}={block}", keys::NAME);
        let root = cst::parse(statement.as_bytes(), 0).map_err(|_| invalid())?;
        let [named] = root.children() else {
            return Err(invalid());
        };
        let src = statement.as_bytes();
        if named.key_str(src) != Some(keys::NAME)
            || named.scalar_span().is_some()
            || named.value_span().end != src.len()
            || NameTemplate::parse(named, src).key.is_empty()
            || !block.ends_with('}')
        {
            return Err(invalid());
        }
        Ok(Self(block.to_owned()))
    }

    /// The indentation of the line the closing brace stands on.
    fn base(&self) -> &str {
        let last = self.0.rsplit('\n').next().unwrap_or_default();
        &last[..last.len() - last.trim_start_matches(['\t', ' ']).len()]
    }

    /// The block written where its closing brace takes `indent`: every line after the first
    /// moved from the block's own indentation to it.
    fn at(&self, indent: &[u8]) -> String {
        let to = String::from_utf8_lossy(indent);
        let base = self.base();
        if base == to {
            return self.0.clone();
        }
        let mut lines = self.0.split('\n');
        let mut out = lines.next().unwrap_or_default().to_owned();
        for line in lines {
            out.push('\n');
            match line.strip_prefix(base) {
                Some(rest) => {
                    out.push_str(&to);
                    out.push_str(rest);
                }
                None => out.push_str(line),
            }
        }
        out
    }
}
