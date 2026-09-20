//! One level of an entity as [`EntityNode`]s: paths, values and the changed flag.
//!
//! A path segment is the child's key; a key repeated among its siblings is followed by
//! its 1-based ordinal and a keyless child is written `#<index>`, so every node at every
//! level has a path that resolves back to exactly one node.

use std::collections::HashMap;

use crate::as_u32;
use crate::cst::{Node, Value};
use crate::entity::views::{EntityNode, NodeValue, ScalarForm};

/// A child block this small has its own scalars inlined beside it, so `coordinate` and
/// `name` read in place (see the design's open question 1).
const INLINE_LIMIT: usize = 8;

/// The node `path` names, walking from `root`.
pub(crate) fn resolve<'n>(root: &'n Node, src: &[u8], path: &[String]) -> Option<&'n Node> {
    let mut current = root;
    let mut i = 0;
    while i < path.len() {
        let segment = path[i].as_str();
        if let Some(index) = segment.strip_prefix('#') {
            current = current.children().get(index.parse::<usize>().ok()?)?;
            i += 1;
            continue;
        }
        let matches: Vec<&Node> = current
            .children()
            .iter()
            .filter(|c| c.key_str(src) == Some(segment))
            .collect();
        match matches.len() {
            0 => return None,
            1 => {
                current = matches[0];
                i += 1;
            }
            _ => {
                let ordinal: usize = path.get(i + 1)?.parse().ok()?;
                current = matches.get(ordinal.checked_sub(1)?)?;
                i += 2;
            }
        }
    }
    Some(current)
}

/// The path segments of each child of `parent`, in save order.
fn segments(parent: &Node, src: &[u8]) -> Vec<Vec<String>> {
    let children = parent.children();
    let mut counts: HashMap<&str, usize> = HashMap::new();
    for child in children {
        if let Some(key) = child.key_str(src) {
            *counts.entry(key).or_default() += 1;
        }
    }
    let mut seen: HashMap<&str, usize> = HashMap::new();
    children
        .iter()
        .enumerate()
        .map(|(index, child)| match child.key_str(src) {
            Some(key) => {
                let ordinal = seen.entry(key).or_default();
                *ordinal += 1;
                if counts[key] > 1 {
                    vec![key.to_owned(), ordinal.to_string()]
                } else {
                    vec![key.to_owned()]
                }
            }
            None => vec![format!("#{index}")],
        })
        .collect()
}

pub(crate) fn value(node: &Node, src: &[u8]) -> NodeValue {
    match &node.value {
        Value::Scalar(span) => {
            let raw = span.slice(src);
            NodeValue::Scalar {
                text: node
                    .scalar_str(src)
                    .map_or_else(|| String::from_utf8_lossy(raw).into_owned(), str::to_owned),
                form: form(raw),
            }
        }
        Value::Block { children, .. } => {
            let count = as_u32(children.len());
            if children.iter().all(|c| c.key.is_none()) {
                NodeValue::List { count }
            } else {
                NodeValue::Block { count }
            }
        }
    }
}

/// How the save wrote the scalar, quotes included.
fn form(raw: &[u8]) -> ScalarForm {
    let quoted = matches!(raw, [b'"', .., b'"']);
    let text = match raw {
        [b'"', inner @ .., b'"'] => inner,
        other => other,
    };
    let Ok(text) = std::str::from_utf8(text) else {
        return ScalarForm::Quoted;
    };
    if is_date(text) {
        return ScalarForm::Date;
    }
    if quoted {
        return ScalarForm::Quoted;
    }
    match text {
        "" => ScalarForm::Empty,
        "yes" | "no" => ScalarForm::Bool,
        "none" => ScalarForm::Null,
        _ if text.parse::<u32>() == Ok(crate::NULL_ID) => ScalarForm::Null,
        _ if is_int(text) => ScalarForm::Int,
        _ if text.parse::<f64>().is_ok() => ScalarForm::Decimal,
        _ => ScalarForm::Ident,
    }
}

fn is_int(text: &str) -> bool {
    let digits = text.strip_prefix('-').unwrap_or(text);
    !digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit())
}

/// `2206.11.16`: three numeric parts, as every date in the save is written.
fn is_date(text: &str) -> bool {
    let parts: Vec<&str> = text.split('.').collect();
    parts.len() == 3
        && parts
            .iter()
            .all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()))
}

/// What a level's nodes are compared against: nothing (the entity is untouched), nothing at
/// this path (an op created the level, so every node is new), or the original node.
#[derive(Clone, Copy)]
pub enum Baseline<'a> {
    Clean,
    New,
    Was(&'a Node, &'a [u8]),
}

/// The children of `parent` as view nodes, with the scalars of small child blocks
/// inlined after their block.
pub(crate) fn level(
    parent: &Node,
    src: &[u8],
    base: &[String],
    original: Baseline<'_>,
) -> Vec<EntityNode> {
    let mut nodes = Vec::new();
    for (child, own) in parent.children().iter().zip(segments(parent, src)) {
        let path: Vec<String> = base.iter().cloned().chain(own.clone()).collect();
        nodes.push(node(child, src, path, &own, original));
        if !inlines(child) {
            continue;
        }
        for (grandchild, tail) in child.children().iter().zip(segments(child, src)) {
            if grandchild.scalar_span().is_none() {
                continue;
            }
            let relative: Vec<String> = own.iter().cloned().chain(tail).collect();
            let path: Vec<String> = base.iter().cloned().chain(relative.clone()).collect();
            nodes.push(node(grandchild, src, path, &relative, original));
        }
    }
    nodes
}

/// A keyed block small enough to read in place.
fn inlines(child: &Node) -> bool {
    match &child.value {
        Value::Block { children, .. } => {
            children.len() <= INLINE_LIMIT && children.iter().any(|c| c.key.is_some())
        }
        Value::Scalar(_) => false,
    }
}

fn node(
    child: &Node,
    src: &[u8],
    path: Vec<String>,
    relative: &[String],
    original: Baseline<'_>,
) -> EntityNode {
    let span = child.span();
    EntityNode {
        key: child.key_str(src).map(str::to_owned),
        path,
        value: value(child, src),
        span: [span.start, span.end],
        changed: match original {
            Baseline::Clean => false,
            Baseline::New => true,
            Baseline::Was(parent, orig) => resolve(parent, orig, relative)
                .is_none_or(|was| was.span().slice(orig) != span.slice(src)),
        },
    }
}
