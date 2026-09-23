//! The `set_star_flag`s of a system's `effect` block that one feature owns. The
//! feature's flags come out whole and go back in at the end of the block, in the shape
//! its statements are written in; every other statement of the block stays byte for
//! byte.

use crate::Span;
use crate::cst::Node;
use crate::format::scenario::fe_zone::SET_STAR_FLAG;
use crate::keys::scenario as keys;
use crate::ops::{Edit, OpError};

/// Take every flag `of_interest` picks off the block and write `new_flags` at its end,
/// writing the block when the system has none and removing it when nothing else stood
/// in it. The predicate sees each flag with the one on the statement right before it,
/// when that statement is a `set_star_flag` too.
pub(super) fn rewrite_flags(
    edit: &mut Edit,
    of_interest: impl Fn(&str, Option<&str>) -> bool,
    new_flags: &[String],
) -> Result<(), OpError> {
    let Some(block) = block(edit, of_interest)? else {
        if !new_flags.is_empty() {
            let statements: Vec<String> = new_flags.iter().map(|f| statement(f)).collect();
            let text = format!("{} = {{ {} }}", keys::EFFECT, statements.join(" "));
            let last = edit
                .entity()?
                .children()
                .last()
                .ok_or_else(|| edit.parse_error(0, "empty system"))?
                .span()
                .end;
            edit.insert_after(last, &text);
        }
        return Ok(());
    };
    if new_flags.is_empty() && block.flags.len() == block.children {
        edit.remove_statement(block.statement);
        return Ok(());
    }
    for span in &block.flags {
        edit.remove_statement(*span);
    }
    for flag in new_flags {
        append(edit, &block, &statement(flag));
    }
    Ok(())
}

fn statement(flag: &str) -> String {
    format!("{SET_STAR_FLAG} = {flag}")
}

/// The `effect` block of the statement being edited, as spans: the CST borrows the
/// buffer the splices then rewrite, so nothing but offsets is carried out of it.
struct Block {
    /// `effect = { … }`, key through closing brace.
    statement: Span,
    /// The braces and what stands between them.
    value: Span,
    /// How many statements the block holds.
    children: usize,
    last_child: Option<Span>,
    /// The `set_star_flag` statements `of_interest` picks, in file order.
    flags: Vec<Span>,
}

fn block(
    edit: &Edit,
    of_interest: impl Fn(&str, Option<&str>) -> bool,
) -> Result<Option<Block>, OpError> {
    let Some(node) = edit.entity()?.find(keys::EFFECT, &edit.buf) else {
        return Ok(None);
    };
    if node.scalar_span().is_some() {
        return Err(edit.parse_error(node.span().start, "effect is not a block"));
    }
    let flag_of = |child: &Node| {
        (child.key_str(&edit.buf) == Some(SET_STAR_FLAG))
            .then(|| child.scalar_str(&edit.buf))
            .flatten()
    };
    let mut flags = Vec::new();
    let mut before = None;
    for child in node.children() {
        let flag = flag_of(child);
        if flag.is_some_and(|flag| of_interest(flag, before)) {
            flags.push(child.span());
        }
        before = flag;
    }
    Ok(Some(Block {
        statement: node.span(),
        value: node.value_span(),
        children: node.children().len(),
        last_child: node.children().last().map(|child| child.span()),
        flags,
    }))
}

/// Write `text` as the block's last statement, in the shape the one standing last is
/// written in. A flag removed from that place is removed up to where it ended, so a
/// statement written there follows what stands before it.
fn append(edit: &mut Edit, block: &Block, text: &str) {
    match block.last_child {
        Some(child) if edit.starts_line(child.start) => {
            let indent = edit.indent(child.start);
            let line = [&indent[..], text.as_bytes(), b"\n"].concat();
            let at = edit.line_end(child.end);
            edit.insert_lines(at, line);
        }
        Some(child) => edit.insert(child.end, format!(" {text}").into_bytes()),
        None => edit.insert(block.value.start + 1, format!(" {text}").into_bytes()),
    }
}
