//! An entity's `variables` block, which the game keeps sorted by name: a ring world sets a
//! system's, a construction raises its owner's, and taking either back lowers them again.

use crate::cst::Node;
use crate::emit::{Lines, coord, inline};
use crate::format::save::entity_in;
use crate::format::save::write::place::{self, Place, insert_key};
use crate::format::save::write::restore::live;
use crate::keys;
use crate::ops::{Edit, OpError, Plan, RingVariable, SavedTable, VariableStep};
use crate::overlay::Anchor;
use crate::session::Session;
use crate::span::Span;

/// Each variable a set wrote, with the value the entity held, as written; `None` where it held
/// none.
pub(crate) type Held = Vec<(String, Option<String>)>;

/// Set each of `variables`, a held one to its value and a new one in its place by name,
/// writing the block at `place` when the entity has none. Returns each one's value before, as
/// written, and whether the block was written.
pub(crate) fn set(
    edit: &mut Edit,
    place: &Place,
    variables: &[RingVariable],
) -> Result<(Held, bool), OpError> {
    if variables.is_empty() {
        return Ok((Vec::new(), false));
    }
    let names: Vec<&str> = variables.iter().map(|v| v.name.as_str()).collect();
    let value = |i: usize| coord(variables[i].value);
    write(edit, place, &names, value, |i, _| Some(value(i)))
}

/// Raise each of `steps`: a held one to its sum, a new one written as the step.
pub(crate) fn raise(edit: &mut Edit, steps: &[VariableStep]) -> Result<(), OpError> {
    let names: Vec<&str> = steps.iter().map(|step| step.variable.as_str()).collect();
    write(
        edit,
        &place::country::VARIABLES,
        &names,
        |i| steps[i].by.to_string(),
        |i, held| Some(coord(held.parse::<f64>().ok()? + f64::from(steps[i].by))),
    )?;
    Ok(())
}

/// Write each of `names`, by its index: a new one as `fresh` gives it, before the first name
/// after it, and in a block at `place` when the entity has none; a held one as `from_held`
/// gives it from the text held, which answers `None` when that text is no number.
fn write(
    edit: &mut Edit,
    place: &Place,
    names: &[&str],
    fresh: impl Fn(usize) -> String,
    from_held: impl Fn(usize, &str) -> Option<String>,
) -> Result<(Held, bool), OpError> {
    let Some(block) = edit.entity()?.find(keys::VARIABLES, &edit.buf).cloned() else {
        let mut sorted: Vec<(&str, String)> = names
            .iter()
            .enumerate()
            .map(|(i, &name)| (name, fresh(i)))
            .collect();
        sorted.sort_by(|a, b| a.0.cmp(b.0));
        let text = |indent: &[u8]| {
            let mut w = Lines::new(indent);
            w.open(0, keys::VARIABLES);
            for (name, text) in &sorted {
                w.pair(1, name, text);
            }
            w.close(0);
            inline(indent, &w.into_bytes())
        };
        insert_key(edit, &[], place, text)?;
        let before = names.iter().map(|&name| (name.to_owned(), None)).collect();
        return Ok((before, true));
    };
    let lines: Vec<(String, Node)> = block
        .children()
        .iter()
        .filter_map(|line| Some((line.key_str(&edit.buf)?.to_owned(), line.clone())))
        .collect();
    let mut before = Vec::new();
    let mut new: Vec<(&str, String)> = Vec::new();
    for (i, &name) in names.iter().enumerate() {
        let Some((_, line)) = lines.iter().find(|(held, _)| held == name) else {
            before.push((name.to_owned(), None));
            new.push((name, fresh(i)));
            continue;
        };
        let no_number = |edit: &Edit, at| edit.parse_error(at, "a variable is no number");
        let span = line
            .scalar_span()
            .ok_or_else(|| no_number(edit, line.span().start))?;
        let held = edit.text(span).to_owned();
        let text = from_held(i, &held).ok_or_else(|| no_number(edit, span.start))?;
        before.push((name.to_owned(), Some(held)));
        edit.replace_span(span, text);
    }
    new.sort_by(|a, b| a.0.cmp(b.0));
    for (name, value) in new {
        let text = format!("{name}={value}");
        match lines.iter().find(|(held, _)| held.as_str() > name) {
            Some((_, after)) => edit.bytes().insert_before(after.span(), &text),
            None => match lines.last() {
                Some((_, last)) => edit.bytes().insert_after(last.span().end, &text),
                None => {
                    let (at, indent) = edit.before_close(&block);
                    let line = [&indent[..], text.as_bytes(), edit.eol(at)].concat();
                    edit.insert(at, line);
                }
            },
        }
    }
    Ok((before, false))
}

/// Put the entity's `variables` back as [`set`] found them: the block goes when it wrote
/// it, else each variable takes back its value or goes.
pub(crate) fn restore(edit: &mut Edit, before: &Held, block_written: bool) -> Result<(), OpError> {
    if before.is_empty() {
        return Ok(());
    }
    let Some(block) = edit.entity()?.find(keys::VARIABLES, &edit.buf).cloned() else {
        return Ok(());
    };
    if block_written {
        edit.bytes().remove_statement(block.span());
        return Ok(());
    }
    for (name, held) in before {
        let Some(line) = block.find(name, &edit.buf) else {
            continue;
        };
        match (held, line.scalar_span()) {
            (Some(held), Some(span)) => edit.replace_span(span, held.clone()),
            (None, _) => edit.bytes().remove_statement(line.span()),
            (Some(_), None) => {}
        }
    }
    Ok(())
}

/// Take back what [`raise`] wrote this session for `steps` on country `owner`: each lowered
/// as far as it was raised, a line going at 0 and the block with its last line when the file
/// held neither. Returns the steps lowered.
pub(crate) fn take_back(
    plan: &mut Plan,
    s: &Session,
    owner: u32,
    steps: &[VariableStep],
) -> Result<Vec<VariableStep>, OpError> {
    let Some(country) = live(&s.doc, SavedTable::Country, owner)? else {
        return Ok(Vec::new());
    };
    let loaded: Option<(Node, &[u8])> = match country.anchor {
        Anchor::Original(span) => {
            let src = span.slice(s.doc.original());
            entity_in(src).ok().flatten().map(|node| (node, src))
        }
        Anchor::Inserted { .. } => None,
    };
    let loaded_block = loaded
        .as_ref()
        .and_then(|(node, src)| Some((node.find(keys::VARIABLES, src)?.clone(), *src)));
    let had_block = loaded_block.is_some();
    let had = |name: &str| {
        loaded_block
            .as_ref()
            .is_some_and(|(block, src)| block.find(name, src).is_some())
    };

    let edit = plan.edit_country(&s.doc, owner)?;
    let Some(block) = edit.entity()?.find(keys::VARIABLES, &edit.buf).cloned() else {
        return Ok(Vec::new());
    };
    let mut lowered = Vec::new();
    let mut changes: Vec<(Span, Option<String>)> = Vec::new();
    for step in steps {
        let Some((line, span, left)) = lowered_line(&block, &edit.buf, step) else {
            continue;
        };
        let change = if left == 0.0 && !had(&step.variable) {
            (line.span(), None)
        } else {
            (span, Some(coord(left)))
        };
        changes.push(change);
        lowered.push(step.clone());
    }
    let gone = changes.iter().filter(|(_, value)| value.is_none()).count();
    if gone == block.children().len() && !had_block {
        edit.bytes().remove_statement(block.span());
        return Ok(lowered);
    }
    for (span, value) in changes {
        match value {
            Some(value) => edit.replace_span(span, value),
            None => edit.bytes().remove_statement(span),
        }
    }
    Ok(lowered)
}

/// Each of the country's variables that `steps` lowers as the game's dismantle does, staying
/// at 0 or above and keeping a line at 0, with its new value.
pub(crate) fn dismantled(
    country: &Node,
    src: &[u8],
    steps: &[VariableStep],
) -> Vec<(Span, String)> {
    let Some(block) = country.find(keys::VARIABLES, src) else {
        return Vec::new();
    };
    steps
        .iter()
        .filter_map(|step| {
            let (_, span, left) = lowered_line(block, src, step)?;
            Some((span, coord(left)))
        })
        .collect()
}

/// The line of `block` that `step` lowers, its value's span and what is left, when the
/// line holds a number that stays at 0 or above.
fn lowered_line<'b>(
    block: &'b Node,
    src: &[u8],
    step: &VariableStep,
) -> Option<(&'b Node, Span, f64)> {
    let line = block.find(&step.variable, src)?;
    let span = line.scalar_span()?;
    let held: f64 = line.scalar_str(src)?.parse().ok()?;
    let left = held - f64::from(step.by);
    (left >= 0.0).then_some((line, span, left))
}
