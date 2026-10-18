//! `SwapSystems`: two systems trade places. Each spot keeps the `coordinate` x, y and
//! `visual_height`, the `arm` and the `hyperlane` block, whose entries name the other of
//! the two where they named the one that moved. Every other system's entries to one of the
//! two name the other. The nebula member lists follow the spots, and a system that joins or
//! leaves a nebula gets or loses a footprint as a move gives it, not the other's.
//! Each value moves as the text it was written as, so swapping again puts back every byte.

use std::collections::BTreeMap;

use crate::cst::Node;
use crate::format::save::write::lanes::{new_block_at, retarget_entries, retargets};
use crate::format::save::write::nebula::{plan_membership, restoring};
use crate::format::save::write::place::{self, insert_key};
use crate::format::save::write::system_height::write_height;
use crate::keys;
use crate::ops::rules::nebula::describe_membership;
use crate::ops::rules::systems::decide_swap;
use crate::ops::{Edit, OpError, Plan, Planned};
use crate::session::Session;

pub(crate) fn plan_swap(
    plan: &mut Plan,
    s: &Session,
    system: u32,
    with: u32,
) -> Result<Planned, OpError> {
    let swap = decide_swap(&s.graph, system, with)?;
    let renamed = swap.renamed();
    let spots = [
        Spot::read(plan.edit(&s.doc, system)?, &renamed)?,
        Spot::read(plan.edit(&s.doc, with)?, &renamed)?,
    ];
    spots[1].write(plan.edit(&s.doc, system)?)?;
    spots[0].write(plan.edit(&s.doc, with)?)?;
    for &id in &s.graph.order {
        if renamed.contains_key(&id) {
            continue;
        }
        let Some(other) = s.graph.systems.get(&id) else {
            continue;
        };
        if other
            .lanes
            .iter()
            .any(|lane| renamed.contains_key(&lane.to))
        {
            retarget_entries(plan.edit(&s.doc, id)?, &renamed)?;
        }
    }
    let (membership, had) = plan_membership(plan, s, &swap.moves)?;
    let description = format!(
        "{}{}",
        swap.describe(),
        describe_membership(&s.graph, &membership, true)
    );
    Ok(Planned {
        inverse: restoring(swap.inverse(), had, &description),
        description,
    })
}

/// What one system's entity says of the spot it stands at, as the text it is written as.
struct Spot {
    x: String,
    y: String,
    height: Option<String>,
    arm: Option<String>,
    /// The `hyperlane` statement, its entries renamed, and the indentation of its key.
    lanes: Option<(Vec<u8>, Vec<u8>)>,
}

impl Spot {
    fn read(edit: &Edit, renamed: &BTreeMap<u32, u32>) -> Result<Self, OpError> {
        let text = |path: &[&str]| -> Result<String, OpError> {
            Ok(edit.text(edit.scalar(path)?).to_owned())
        };
        let optional = |node: Option<&Node>| {
            node.and_then(Node::scalar_span)
                .map(|span| edit.text(span).to_owned())
        };
        let entity = edit.entity()?;
        let coordinate = entity.find(keys::COORDINATE, &edit.buf);
        let lanes = match edit.hyperlane()? {
            Some(block) => {
                edit.require_block_shape(block)?;
                let span = block.span();
                let mut text = Vec::new();
                let mut at = span.start;
                for (to, id) in retargets(edit, block, renamed)? {
                    text.extend_from_slice(&edit.buf[at..to.start]);
                    text.extend_from_slice(id.to_string().as_bytes());
                    at = to.end;
                }
                text.extend_from_slice(&edit.buf[at..span.end]);
                Some((text, edit.indent(span.start)))
            }
            None => None,
        };
        Ok(Self {
            x: text(&[keys::COORDINATE, keys::X])?,
            y: text(&[keys::COORDINATE, keys::Y])?,
            height: optional(coordinate.and_then(|c| c.find(keys::VISUAL_HEIGHT, &edit.buf))),
            arm: optional(entity.find(keys::ARM, &edit.buf)),
            lanes,
        })
    }

    /// Make the entity stand at this spot. The lanes are planned before the `arm`, which
    /// lands after them when both go in after `star_class`.
    fn write(&self, edit: &mut Edit) -> Result<(), OpError> {
        edit.set_scalar(&[keys::COORDINATE, keys::X], self.x.as_str())?;
        edit.set_scalar(&[keys::COORDINATE, keys::Y], self.y.as_str())?;
        write_height(edit, self.height.as_deref())?;

        let block = edit.hyperlane()?.map(Node::span);
        match (block, &self.lanes) {
            (Some(span), Some((text, from))) => {
                let to = edit.indent(span.start);
                edit.replace_span(span, reindented(text, from, &to));
            }
            (Some(span), None) => edit.bytes().remove_lines(span),
            (None, Some((text, from))) => {
                let (at, to) = new_block_at(edit)?;
                let eol = edit.eol(at.saturating_sub(1));
                let line = [&to[..], &reindented(text, from, &to), eol].concat();
                edit.insert(at, line);
            }
            (None, None) => {}
        }

        let arm = edit.entity()?.find(keys::ARM, &edit.buf).map(Node::span);
        match (arm, &self.arm) {
            (Some(_), Some(value)) => edit.set_scalar(&[keys::ARM], value.as_str())?,
            (Some(span), None) => edit.bytes().remove_statement(span),
            (None, Some(value)) => {
                let text = format!("{}={value}", keys::ARM);
                insert_key(edit, &[], &place::system::ARM, |_| text)?;
            }
            (None, None) => {}
        }
        Ok(())
    }
}

/// `text` with the indentation `from` that begins each line after its first given as `to`.
fn reindented(text: &[u8], from: &[u8], to: &[u8]) -> Vec<u8> {
    if from == to {
        return text.to_vec();
    }
    let mut out = Vec::with_capacity(text.len());
    for (i, line) in text.split_inclusive(|&b| b == b'\n').enumerate() {
        match line.strip_prefix(from).filter(|_| i > 0) {
            Some(rest) => {
                out.extend_from_slice(to);
                out.extend_from_slice(rest);
            }
            None => out.extend_from_slice(line),
        }
    }
    out
}
