//! A system's last `effect` block, the one the game runs, as the statement writers that own
//! some of its statements splice it: their statements come out where they stand and new ones
//! go in at its end, in the shape the statement standing last is written in. Every other
//! statement of the block stays byte for byte.

use crate::Span;
use crate::format::scenario::effect;
use crate::keys::scenario as keys;
use crate::ops::{Edit, OpError};

/// The last `effect` block of the statement being edited, as spans: the CST borrows the
/// buffer the splices then rewrite, so nothing but offsets is carried out of it.
pub(super) struct EffectBlock {
    /// `effect = { … }`, key through closing brace.
    statement: Span,
    /// The braces and what stands between them.
    value: Span,
    children: Vec<Span>,
    /// Whether it is the system's only `effect` block.
    only: bool,
}

/// The last `effect` block of the system being edited, `None` when it has none.
pub(super) fn last(edit: &Edit) -> Result<Option<EffectBlock>, OpError> {
    let system = edit.entity()?;
    let Some(node) = effect::block(system, &edit.buf) else {
        return Ok(None);
    };
    if node.scalar_span().is_some() {
        return Err(edit.parse_error(node.span().start, "effect is not a block"));
    }
    Ok(Some(EffectBlock {
        statement: node.span(),
        value: node.value_span(),
        children: node.children().iter().map(|child| child.span()).collect(),
        only: effect::blocks(system, &edit.buf) == 1,
    }))
}

/// Take each of `remove` out of `block` and write `add` at its end, writing a block after
/// the system's last statement when it has none. A block left empty goes too, unless an
/// earlier block would then be the one the game runs.
pub(super) fn splice(
    edit: &mut Edit,
    block: Option<&EffectBlock>,
    remove: &[Span],
    add: &[String],
) -> Result<(), OpError> {
    let Some(block) = block else {
        if !add.is_empty() {
            let text = format!("{} = {{ {} }}", keys::EFFECT, add.join(" "));
            let last = edit
                .entity()?
                .children()
                .last()
                .ok_or_else(|| edit.parse_error(0, "empty system"))?
                .span()
                .end;
            edit.bytes().insert_after(last, &text);
        }
        return Ok(());
    };
    let emptied = block.children.iter().all(|child| {
        remove
            .iter()
            .any(|span| span.start <= child.start && child.end <= span.end)
    });
    if add.is_empty() && emptied && block.only {
        edit.bytes().remove_statement(block.statement);
        return Ok(());
    }
    for span in remove {
        edit.bytes().remove_statement(*span);
    }
    for text in add {
        append(edit, block, text);
    }
    Ok(())
}

/// Write `text` as the block's last statement, in the shape the one standing last is
/// written in. A statement removed from that place is removed up to where it ended, so a
/// statement written there follows what stands before it.
fn append(edit: &mut Edit, block: &EffectBlock, text: &str) {
    let close = block.value.end - 1;
    match block.children.last() {
        // A block closing on its last statement's line takes the new one beside it, inside.
        Some(child) if edit.starts_line(child.start) && edit.line_end(child.end) <= close => {
            let indent = edit.indent(child.start);
            let line = [&indent[..], text.as_bytes(), edit.eol(child.start)].concat();
            let at = edit.line_end(child.end);
            edit.insert(at, line);
        }
        Some(child) => edit.insert(child.end, format!(" {text}").into_bytes()),
        None => edit.insert(block.value.start + 1, format!(" {text}").into_bytes()),
    }
}
