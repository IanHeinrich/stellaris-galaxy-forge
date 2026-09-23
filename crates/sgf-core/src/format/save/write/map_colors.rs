//! An empire's map colours: the border and fill a 4.5 save keeps as the fifth and sixth
//! entries of `country.<id>.flag.colors`, which the game paints territory in only under
//! `flag.use_map_color=yes`.
//!
//! `use_map_color=yes` is written as the statement after `colors`, where the game writes
//! it, so turning map colours off and on again restores the block's bytes.

use crate::Span;
use crate::cst::Node;
use crate::keys;
use crate::ops::{MapColorPair, Op, OpError, Plan, Planned};
use crate::session::Session;

const FLAG_FIRST: usize = 0;
const FLAG_SECOND: usize = 1;
const MAP_BORDER: usize = 4;
const MAP_FILL: usize = 5;

pub(crate) fn plan_set(
    plan: &mut Plan,
    s: &Session,
    country: u32,
    colors: Option<&MapColorPair>,
) -> Result<Planned, OpError> {
    if let Some(pair) = colors {
        check_name(&pair.border)?;
        check_name(&pair.fill)?;
    }
    let edit = plan.edit_country(&s.doc, country)?;
    let entity = edit.entity()?;
    let flag = entity
        .find(keys::FLAG, &edit.buf)
        .ok_or_else(|| edit.parse_error(entity.span().start, "no flag"))?;
    let list = flag
        .find(keys::COLORS, &edit.buf)
        .ok_or_else(|| edit.parse_error(flag.span().start, "no flag.colors"))?;
    let entries: Vec<&Node> = list.children().iter().filter(|c| c.key.is_none()).collect();
    if entries.len() <= MAP_FILL {
        return Err(OpError::NoMapColors(country));
    }
    let entry = |i: usize| -> Result<(Span, String), OpError> {
        let node = entries[i];
        let span = node
            .scalar_span()
            .ok_or_else(|| edit.parse_error(node.span().start, "colour entry is a block"))?;
        let name = node.scalar_str(&edit.buf).unwrap_or_default().to_owned();
        Ok((span, name))
    };
    let (border_span, old_border) = entry(MAP_BORDER)?;
    let (fill_span, old_fill) = entry(MAP_FILL)?;
    let switches: Vec<(Span, Option<String>)> = flag
        .find_all(keys::USE_MAP_COLOR, &edit.buf)
        .map(|n| (n.span(), n.scalar_str(&edit.buf).map(str::to_owned)))
        .collect();
    let on = switches
        .first()
        .is_some_and(|(_, value)| value.as_deref() == Some("yes"));
    let (border, fill) = match colors {
        Some(pair) => (pair.border.clone(), pair.fill.clone()),
        None => (entry(FLAG_FIRST)?.1, entry(FLAG_SECOND)?.1),
    };
    let unchanged = match colors {
        Some(_) => on,
        None => switches.is_empty(),
    } && border == old_border
        && fill == old_fill;
    if unchanged {
        return Err(OpError::MapColorsUnchanged(country));
    }
    let list_end = list.span().end;

    for (span, old, new) in [
        (border_span, &old_border, &border),
        (fill_span, &old_fill, &fill),
    ] {
        if old != new {
            edit.splices
                .push((span.range(), format!("\"{new}\"").into_bytes()));
        }
    }
    match (colors, switches.first()) {
        (Some(_), None) => edit.insert_after(list_end, &format!("{}=yes", keys::USE_MAP_COLOR)),
        (Some(_), Some(_)) if on => {}
        (Some(_), Some((span, _))) => {
            edit.replace_statement(*span, &format!("{}=yes", keys::USE_MAP_COLOR));
        }
        (None, _) => {
            for (span, _) in &switches {
                edit.remove_statement(*span);
            }
        }
    }

    let description = match colors {
        Some(_) => format!("Set empire {country}'s map colours to {border} and {fill}"),
        None => format!("Set empire {country} to use its flag colours on the map"),
    };
    Ok(Planned {
        description,
        inverse: Op::SetEmpireMapColors {
            country,
            colors: on.then_some(MapColorPair {
                border: old_border,
                fill: old_fill,
            }),
        },
    })
}

/// Refuse a name that cannot stand as one quoted `colors` entry.
fn check_name(name: &str) -> Result<(), OpError> {
    let breaks = |c: char| c.is_whitespace() || c == '"' || c == '\\';
    if name.is_empty() || name.contains(breaks) {
        return Err(OpError::InvalidColorName(name.to_owned()));
    }
    Ok(())
}
