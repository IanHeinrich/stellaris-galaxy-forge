//! A save's L-Cluster outcome: the flags `distar.8000` sets on day one in the top-level
//! `flags` block, which the game reads back only when a gate opens.
//!
//! The chosen outcome's flags are written where the first outcome flag stood, else after
//! the block's last entry, so switching away and back again restores the block's bytes.

use crate::Span;
use crate::cst::Node;
use crate::format::save::galaxy::lgate::{ALL_OUTCOME_FLAGS, GAME_STARTED, flags_of};
use crate::ops::{Edit, Op, OpError, Plan, Planned};
use crate::projections::galaxy::LGateOutcome;
use crate::session::Session;

pub(crate) fn plan_set_outcome(
    plan: &mut Plan,
    s: &Session,
    outcome: LGateOutcome,
) -> Result<Planned, OpError> {
    let lgate = s.graph.lgate.ok_or(OpError::NoLGate)?;
    if lgate.opened {
        return Err(OpError::LGateOpened);
    }
    if lgate.outcome == outcome {
        return Err(OpError::LGateUnchanged(outcome.label()));
    }
    let edit = plan.edit_flags(&s.doc)?;
    let flags = edit.entity()?;
    let date = flags
        .find(GAME_STARTED, &edit.buf)
        .and_then(Node::scalar_span)
        .ok_or_else(|| edit.parse_error(flags.span().start, "no game_started date"))?;
    let written: Vec<String> = flags_of(outcome)
        .iter()
        .map(|flag| format!("{flag}={}", edit.text(date)))
        .collect();
    let present: Vec<Span> = flags
        .children()
        .iter()
        .filter(|n| {
            n.key_str(&edit.buf)
                .is_some_and(|key| ALL_OUTCOME_FLAGS.contains(&key))
        })
        .map(Node::span)
        .collect();
    let last = flags.children().last().map(Node::span);
    let value = flags.value_span();

    match (present.first(), last) {
        (Some(&first), _) => {
            for text in &written {
                write_before(edit, first, text);
            }
            for span in present {
                edit.remove_statement(span);
            }
        }
        (None, Some(last)) => {
            for text in &written {
                edit.insert_after(last.end, text);
            }
        }
        (None, None) => {
            for text in &written {
                edit.insert_first(value, None, text);
            }
        }
    }
    Ok(Planned {
        description: format!("Set the L-Gate outcome to {}", outcome.label()),
        inverse: Op::SetLGateOutcome {
            outcome: lgate.outcome,
        },
    })
}

/// Write `text` as a statement just ahead of the one at `span`, in its shape: on a line of
/// its own when that one starts its line, else beside it where its removal leaves off.
fn write_before(edit: &mut Edit, span: Span, text: &str) {
    if edit.starts_line(span.start) {
        let line = [&edit.indent(span.start)[..], text.as_bytes(), b"\n"].concat();
        edit.insert_lines(edit.line_start(span.start), line);
    } else {
        edit.insert(span.end, format!(" {text}").into_bytes());
    }
}
