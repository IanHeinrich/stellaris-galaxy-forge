//! An empire's map colours: the border and fill a 4.5 save keeps as the fifth and sixth
//! entries of `country.<id>.flag.colors`, which the game paints territory in only under
//! `flag.use_map_color=yes`, and the same in the save's `meta`, which holds a copy of the
//! player's flag for the load screen.
//!
//! `use_map_color=yes` is written as the statement after `colors`, where the game writes
//! it, so turning map colours off and on again restores the block's bytes.

use crate::Span;
use crate::cst::{self, Node};
use crate::document::Document;
use crate::keys;
use crate::ops::rules::{Form, check_text, quoted};
use crate::ops::{BufEdit, MapColorPair, Op, OpError, Plan, Planned, spliced};
use crate::session::Session;

const FLAG_FIRST: usize = 0;
const FLAG_SECOND: usize = 1;
const MAP_BORDER: usize = 4;
const MAP_FILL: usize = 5;

/// A place in the bytes the flag cannot be read at, and why.
type Unreadable = (usize, String);

pub(crate) fn plan_set(
    plan: &mut Plan,
    s: &Session,
    country: u32,
    colors: Option<&MapColorPair>,
) -> Result<Planned, OpError> {
    if let Some(pair) = colors {
        check_text("a colour name", &pair.border, Form::Bare)?;
        check_text("a colour name", &pair.fill, Form::Bare)?;
    }
    let edit = plan.edit_country(&s.doc, country)?;
    let entity = edit.entity()?;
    let flag = entity
        .find(keys::FLAG, &edit.buf)
        .ok_or_else(|| edit.parse_error(entity.span().start, "no flag"))?;
    let parse_error = |(offset, reason): Unreadable| edit.parse_error(offset, reason);
    let current = MapColors::read(flag, &edit.buf)
        .map_err(parse_error)?
        .ok_or(OpError::NoMapColors(country))?;
    let on = current.on();
    let mut splices = Vec::new();
    let mut out = BufEdit {
        buf: &edit.buf,
        splices: &mut splices,
    };
    let old = current
        .write(&mut out, colors)
        .map_err(parse_error)?
        .ok_or(OpError::MapColorsUnchanged(country))?;
    edit.splices.extend(splices);
    if s.graph.player_country == Some(country) {
        plan_meta(plan, &s.doc, colors)?;
    }

    let description = match colors {
        Some(pair) => format!(
            "Set empire {country}'s map colours to {} and {}",
            pair.border, pair.fill
        ),
        None => format!("Set empire {country} to use its flag colours on the map"),
    };
    Ok(Planned {
        description,
        inverse: Op::SetEmpireMapColors {
            country,
            colors: on.then_some(old),
        },
    })
}

/// Set the player's map colours in `meta` as [`plan_set`] sets the country's, from the
/// values `meta` holds. A `meta` with no flag, or with no map colours in it, is left as
/// it is.
fn plan_meta(
    plan: &mut Plan,
    doc: &Document,
    colors: Option<&MapColorPair>,
) -> Result<(), OpError> {
    let meta = doc.meta();
    let parse_error = |(offset, reason): Unreadable| OpError::MetaParse { offset, reason };
    let root = cst::parse(meta, 0).map_err(|e| parse_error((e.offset, e.reason.to_owned())))?;
    let Some(flag) = root.find(keys::FLAG, meta) else {
        return Ok(());
    };
    let Some(current) = MapColors::read(flag, meta).map_err(parse_error)? else {
        return Ok(());
    };
    let mut splices = Vec::new();
    let mut out = BufEdit {
        buf: meta,
        splices: &mut splices,
    };
    if current
        .write(&mut out, colors)
        .map_err(parse_error)?
        .is_none()
    {
        return Ok(());
    }
    let bytes = spliced(meta, splices)
        .map_err(|offset| parse_error((offset, "edit ranges overlap".to_owned())))?;
    plan.replace_meta(bytes);
    Ok(())
}

/// The map colours a `flag` block holds: its `colors` list, the list's entries and every
/// `use_map_color` switch.
struct MapColors<'n> {
    buf: &'n [u8],
    list: &'n Node,
    entries: Vec<&'n Node>,
    switches: Vec<(Span, Option<String>)>,
}

impl<'n> MapColors<'n> {
    /// The map colours of the `flag` block `node` of `buf`, `None` when its `colors` list
    /// has no fifth and sixth entries.
    fn read(node: &'n Node, buf: &'n [u8]) -> Result<Option<Self>, Unreadable> {
        let list = node
            .find(keys::COLORS, buf)
            .ok_or_else(|| (node.span().start, "no flag.colors".to_owned()))?;
        let entries: Vec<&Node> = list.children().iter().filter(|c| c.key.is_none()).collect();
        if entries.len() <= MAP_FILL {
            return Ok(None);
        }
        let switches = node
            .find_all(keys::USE_MAP_COLOR, buf)
            .map(|n| (n.span(), n.scalar_str(buf).map(str::to_owned)))
            .collect();
        Ok(Some(Self {
            buf,
            list,
            entries,
            switches,
        }))
    }

    fn on(&self) -> bool {
        self.switches
            .first()
            .is_some_and(|(_, value)| value.as_deref() == Some("yes"))
    }

    fn entry(&self, i: usize) -> Result<(Span, String), Unreadable> {
        let node = self.entries[i];
        let span = node
            .scalar_span()
            .ok_or_else(|| (node.span().start, "colour entry is a block".to_owned()))?;
        let name = node.scalar_str(self.buf).unwrap_or_default().to_owned();
        Ok((span, name))
    }

    /// Plan in `out` the splices that set the map colours to `colors` with the switch on,
    /// or with `None` to the flag's first two with the switch gone. Returns the border and
    /// fill they replace, or `None` when nothing would change.
    fn write(
        &self,
        out: &mut BufEdit,
        colors: Option<&MapColorPair>,
    ) -> Result<Option<MapColorPair>, Unreadable> {
        let (border_span, old_border) = self.entry(MAP_BORDER)?;
        let (fill_span, old_fill) = self.entry(MAP_FILL)?;
        let on = self.on();
        let (border, fill) = match colors {
            Some(pair) => (pair.border.clone(), pair.fill.clone()),
            None => (self.entry(FLAG_FIRST)?.1, self.entry(FLAG_SECOND)?.1),
        };
        let unchanged = match colors {
            Some(_) => on,
            None => self.switches.is_empty(),
        } && border == old_border
            && fill == old_fill;
        if unchanged {
            return Ok(None);
        }

        for (span, old, new) in [
            (border_span, &old_border, &border),
            (fill_span, &old_fill, &fill),
        ] {
            if old != new {
                out.replace_span(span, quoted(new));
            }
        }
        let switch = format!("{}=yes", keys::USE_MAP_COLOR);
        match (colors, self.switches.first()) {
            (Some(_), None) => out.insert_after(self.list.span().end, &switch),
            (Some(_), Some(_)) if on => {}
            (Some(_), Some((span, _))) => out.replace_statement(*span, &switch),
            (None, _) => {
                for (span, _) in &self.switches {
                    out.remove_statement(*span);
                }
            }
        }
        Ok(Some(MapColorPair {
            border: old_border,
            fill: old_fill,
        }))
    }
}
