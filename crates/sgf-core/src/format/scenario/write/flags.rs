//! The statements of a system's `effect` block that one feature owns, most of them
//! `set_star_flag`s. The feature's statements come out whole and go back in at the end of
//! the block, as [`effect_block`] splices it.

use crate::Span;
use crate::cst::Node;
use crate::format::scenario::effect;
use crate::format::scenario::fe_zone::SET_STAR_FLAG;
use crate::ops::{Edit, OpError};

use super::effect_block;

/// Take every flag `of_interest` picks off the block and write `new_flags` at its end,
/// writing the block when the system has none and removing it when nothing else stood
/// in it. The predicate sees each flag with the one on the statement right before it,
/// when that statement is a `set_star_flag` too.
pub(super) fn rewrite_flags(
    edit: &mut Edit,
    of_interest: impl Fn(&str, Option<&str>) -> bool,
    new_flags: &[String],
) -> Result<(), OpError> {
    let statements: Vec<String> = new_flags.iter().map(|f| statement(f)).collect();
    let picks = |statement: Statement<'_>| {
        statement.key == SET_STAR_FLAG
            && statement
                .value
                .is_some_and(|flag| of_interest(flag, statement.before))
    };
    rewrite(edit, picks, &statements)
}

/// Take every statement `of_interest` picks by its text off the block and write
/// `new_statements` at its end, as [`rewrite_flags`] does with flags.
pub(super) fn rewrite_statements(
    edit: &mut Edit,
    of_interest: impl Fn(&str) -> bool,
    new_statements: &[String],
) -> Result<(), OpError> {
    rewrite(
        edit,
        |statement| of_interest(statement.text),
        new_statements,
    )
}

/// One statement of the block as a predicate sees it: its key, its value when that is a
/// scalar, its whole text and the flag on the statement right before it.
#[derive(Clone, Copy)]
struct Statement<'a> {
    key: &'a str,
    value: Option<&'a str>,
    text: &'a str,
    before: Option<&'a str>,
}

fn rewrite(
    edit: &mut Edit,
    of_interest: impl Fn(Statement<'_>) -> bool,
    new_statements: &[String],
) -> Result<(), OpError> {
    let block = effect_block::last(edit)?;
    let picked = picked(edit, of_interest)?;
    effect_block::splice(edit, block.as_ref(), &picked, new_statements)
}

fn statement(flag: &str) -> String {
    format!("{SET_STAR_FLAG} = {flag}")
}

/// The statements of the last `effect` block `of_interest` picks, in file order.
fn picked(edit: &Edit, of_interest: impl Fn(Statement<'_>) -> bool) -> Result<Vec<Span>, OpError> {
    let Some(node) = effect::block(edit.entity()?, &edit.buf) else {
        return Ok(Vec::new());
    };
    let flag_of = |child: &Node| {
        (child.key_str(&edit.buf) == Some(SET_STAR_FLAG))
            .then(|| child.scalar_str(&edit.buf))
            .flatten()
    };
    let mut picked = Vec::new();
    let mut before = None;
    for child in node.children() {
        let statement = Statement {
            key: child.key_str(&edit.buf).unwrap_or_default(),
            value: child.scalar_str(&edit.buf),
            text: edit.text(child.span()),
            before,
        };
        if of_interest(statement) {
            picked.push(child.span());
        }
        before = flag_of(child);
    }
    Ok(picked)
}
