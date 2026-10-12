//! `inline_script` calls read as the game reads them: the script's text from
//! `common/inline_scripts`, its parameters put in, in place of the call.

use std::borrow::Cow;
use std::path::PathBuf;
use std::sync::Arc;

use sgf_core::cst::{self, Node};

use crate::install::layers::Layout;
use crate::install::script::{Def, written};

/// How deep [`expand`] follows a script that calls another.
pub(crate) const MAX_DEPTH: usize = 4;

/// The text one `inline_script` call reads, its parameters put in.
pub(crate) struct ScriptText {
    /// Its `script`, the path under `common/inline_scripts` without `.txt`.
    pub script: String,
    pub file: PathBuf,
    pub text: Vec<u8>,
}

/// The text `call` reads: `inline_script = name`, or `inline_script = { script = name … }`
/// with each other scalar of the block a parameter. A quoted value goes in without its quotes,
/// so a parameter can carry a block of script. `None` when the install has no such script.
pub(crate) fn read(call: &Node, src: &[u8], layout: &Layout) -> Option<ScriptText> {
    let args = call.children();
    let (script, params): (&str, Vec<(&str, Cow<str>)>) = match call.scalar_str(src) {
        Some(script) => (script, Vec::new()),
        None => (
            call.find("script", src)?.scalar_str(src)?,
            (0..args.len())
                .filter_map(|at| Some((args[at].key_str(src)?, written(args, at, src)?)))
                .filter(|(key, _)| *key != "script")
                .collect(),
        ),
    };
    let file = layout.resolve_file(&format!("common/inline_scripts/{script}.txt"))?;
    let raw = std::fs::read(&file).ok()?;
    Some(ScriptText {
        script: script.to_owned(),
        file,
        text: substitute(&raw, &params),
    })
}

/// `def` with every `inline_script` its block calls, at any depth, read in place of the call,
/// and the calls those scripts make in turn, [`MAX_DEPTH`] deep. `None` when it calls none the
/// install has, or when the text does not parse once the scripts are in.
pub(crate) fn expand(def: &Def, layout: &Layout) -> Option<Def> {
    let mut replaced = 0;
    let text = splice(
        &def.node,
        &def.src,
        def.node.span().range(),
        layout,
        1,
        &mut replaced,
    );
    if replaced == 0 {
        return None;
    }
    let node = cst::parse_script(&text, 0)
        .ok()?
        .children()
        .first()
        .cloned()?;
    Some(Def {
        node,
        src: text.into(),
        file: def.file.clone(),
        vars: Arc::clone(&def.vars),
        globals: Arc::clone(&def.globals),
    })
}

/// `src[range]`, which `node` spans, with each call below `node` replaced by its script's
/// text, expanded in turn while `depth` is below [`MAX_DEPTH`]. `replaced` counts the calls
/// replaced.
fn splice(
    node: &Node,
    src: &[u8],
    range: std::ops::Range<usize>,
    layout: &Layout,
    depth: usize,
    replaced: &mut usize,
) -> Vec<u8> {
    let mut calls = Vec::new();
    calls_in(node, src, &mut calls);
    let mut out = Vec::with_capacity(range.len());
    let mut from = range.start;
    for call in calls {
        let Some(script) = read(call, src, layout) else {
            continue;
        };
        let span = call.span();
        out.extend_from_slice(&src[from..span.start]);
        out.extend(if depth < MAX_DEPTH {
            expand_text(script.text, layout, depth + 1, replaced)
        } else {
            script.text
        });
        *replaced += 1;
        from = span.end;
    }
    out.extend_from_slice(&src[from..range.end]);
    out
}

/// A script's `text` with the calls it makes expanded; as it is when it does not parse.
fn expand_text(text: Vec<u8>, layout: &Layout, depth: usize, replaced: &mut usize) -> Vec<u8> {
    let Ok(root) = cst::parse_script(&text, 0) else {
        return text;
    };
    splice(&root, &text, 0..text.len(), layout, depth, replaced)
}

/// Each `inline_script` statement below `node`, in order, none inside another.
fn calls_in<'n>(node: &'n Node, src: &[u8], out: &mut Vec<&'n Node>) {
    for child in node.children() {
        if child.key_str(src) == Some("inline_script") {
            out.push(child);
        } else {
            calls_in(child, src, out);
        }
    }
}

/// `text` with its conditional blocks settled, then each `$NAME$` and `$NAME|default$`
/// replaced by the value `params` gives `NAME`, or its default; a parameter with neither is
/// left as written.
pub(crate) fn substitute(text: &[u8], params: &[(&str, Cow<str>)]) -> Vec<u8> {
    put_params(&conditionals(text, params), params)
}

fn put_params(text: &[u8], params: &[(&str, Cow<str>)]) -> Vec<u8> {
    let mut out = Vec::with_capacity(text.len());
    let mut rest = text;
    while let Some(open) = rest.iter().position(|&b| b == b'$') {
        out.extend_from_slice(&rest[..open]);
        let after = &rest[open + 1..];
        let Some(close) = after.iter().position(|&b| b == b'$') else {
            out.extend_from_slice(&rest[open..]);
            return out;
        };
        let inner = &after[..close];
        let (name, default) = match inner.iter().position(|&b| b == b'|') {
            Some(bar) => (&inner[..bar], Some(&inner[bar + 1..])),
            None => (inner, None),
        };
        let value = params
            .iter()
            .find(|(key, _)| key.as_bytes() == name)
            .map(|(_, value)| value.as_bytes())
            .or(default);
        match value {
            Some(value) => out.extend_from_slice(value),
            None => out.extend_from_slice(&rest[open..open + close + 2]),
        }
        rest = &after[close + 1..];
    }
    out.extend_from_slice(rest);
    out
}

/// `text` with each `[[NAME] … ]` kept when `params` gives `NAME`, and each `[[!NAME] … ]`
/// kept when it does not, nested ones settled in turn. A block that is dropped leaves its
/// line breaks, so the text keeps the lines of its file.
fn conditionals(text: &[u8], params: &[(&str, Cow<str>)]) -> Vec<u8> {
    let mut out = Vec::with_capacity(text.len());
    let mut at = 0;
    while at < text.len() {
        let Some(block) = conditional(text, at) else {
            out.push(text[at]);
            at += 1;
            continue;
        };
        let given = params.iter().any(|(key, _)| key.as_bytes() == block.name);
        let body = &text[block.body.clone()];
        if given != block.negated {
            out.extend(conditionals(body, params));
        } else {
            out.extend(body.iter().filter(|&&b| b == b'\n'));
        }
        at = block.end;
    }
    out
}

/// A `[[NAME] … ]` or `[[!NAME] … ]` block of an inline script.
struct Conditional<'t> {
    name: &'t [u8],
    negated: bool,
    /// Its text, between the header and the closing bracket.
    body: std::ops::Range<usize>,
    /// Just past the closing bracket.
    end: usize,
}

/// The conditional block that starts at `at` in `text`, when one does and it closes.
fn conditional(text: &[u8], at: usize) -> Option<Conditional<'_>> {
    let rest = text.get(at..)?.strip_prefix(b"[[")?;
    let header_len = rest.iter().position(|&b| b == b']')?;
    let header = &rest[..header_len];
    let (negated, name) = match header.strip_prefix(b"!") {
        Some(name) => (true, name),
        None => (false, header),
    };
    let word = |b: &u8| b.is_ascii_alphanumeric() || *b == b'_';
    if name.is_empty() || !name.iter().all(word) {
        return None;
    }
    let start = at + 2 + header_len + 1;
    let mut depth = 1;
    for (offset, &b) in text[start..].iter().enumerate() {
        match b {
            b'[' => depth += 1,
            b']' => {
                depth -= 1;
                if depth == 0 {
                    return Some(Conditional {
                        name,
                        negated,
                        body: start..start + offset,
                        end: start + offset + 1,
                    });
                }
            }
            _ => {}
        }
    }
    None
}
