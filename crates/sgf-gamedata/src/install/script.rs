//! Top-level `key = { … }` definitions of one `common/` directory across
//! every layer, a repeated key settled by [`Keeps`].

use std::borrow::Cow;
use std::collections::BTreeMap;
use std::collections::btree_map::Entry;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use sgf_core::cst::{self, Node, Value};

use crate::Diagnostic;
use crate::install::layers::Layout;

/// One definition block with the file bytes its spans point into.
#[derive(Debug, Clone)]
pub struct Def {
    pub node: Node,
    pub src: Arc<[u8]>,
    pub file: PathBuf,
    /// The defining file's top-level `@name = value` scalars, `@` stripped.
    pub vars: Arc<BTreeMap<String, Variable>>,
    pub globals: Arc<Variables>,
}

/// An `@name = value` scalar's value and the line it is written on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Variable {
    pub value: String,
    pub line: u32,
}

impl Def {
    /// The file and line `@name` is defined on, `@` stripped from the name: the defining
    /// file's own first, then `common/scripted_variables`.
    pub fn variable_at(&self, name: &str) -> Option<(&Path, u32)> {
        match self.vars.get(name) {
            Some(own) => Some((&self.file, own.line)),
            None => self.globals.defined_at(name),
        }
    }

    /// The unquoted scalar value of the first direct child named `key`.
    pub fn scalar(&self, key: &str) -> Option<&str> {
        self.node.find(key, &self.src)?.scalar_str(&self.src)
    }

    pub fn flag(&self, key: &str) -> bool {
        self.scalar(key) == Some("yes")
    }

    /// `key`'s value as a number, through [`Self::number_of`].
    pub fn number(&self, key: &str) -> Option<f64> {
        self.number_of(&self.written_in(&self.node, key)?)
    }

    /// A number as written, the `@variable` it names, or inline maths `@[ … ]` over numbers
    /// and variables: a variable from the defining file's own first, then
    /// `common/scripted_variables`.
    pub fn number_of(&self, text: &str) -> Option<f64> {
        if let Some(expr) = text.strip_prefix("@[").and_then(|t| t.strip_suffix(']')) {
            return maths::evaluate(expr, &|name| self.variable(name)?.parse().ok());
        }
        match text.strip_prefix('@') {
            Some(name) => self.variable(name)?.parse().ok(),
            None => text.parse().ok(),
        }
    }

    fn variable(&self, name: &str) -> Option<&str> {
        self.vars
            .get(name)
            .map(|own| own.value.as_str())
            .or_else(|| self.globals.get(name))
    }

    /// The scalar value of the first direct child of `node` named `key`, as [`written`] reads it.
    fn written_in(&self, node: &Node, key: &str) -> Option<Cow<'_, str>> {
        let children = node.children();
        let at = children
            .iter()
            .position(|child| child.key_str(&self.src) == Some(key))?;
        written(children, at, &self.src)
    }

    /// `key` below `node` as a [`Range`]: `key = n` or `key = { min = a max = b }`,
    /// `@variables` substituted; one no file defines gives `None`.
    pub fn range_in(&self, node: &Node, key: &str) -> Option<Range> {
        let found = node.find(key, &self.src)?;
        match found.scalar_span() {
            Some(_) => self
                .number_of(&self.written_in(node, key)?)
                .map(Range::fixed),
            None => self.range_of(found),
        }
    }

    /// `found`'s value as a [`Range`], as [`Self::range_in`] reads it.
    pub fn range_of(&self, found: &Node) -> Option<Range> {
        if let Some(text) = found.scalar_str(&self.src) {
            return self.number_of(text).map(Range::fixed);
        }
        Some(Range {
            min: self.bound(found, "min")?,
            max: self.bound(found, "max")?,
        })
    }

    /// An initializer's own value `found` (a `count`, `size`, `orbit_distance`, `orbit_angle`,
    /// `change_orbit` or belt `radius`) as a [`Range`]: as [`Self::range_of`] reads it, but a
    /// block that writes one bound only is that number, fixed. No game file says what the game
    /// does with the missing bound, so this is assumed.
    pub fn initializer_range_of(&self, found: &Node) -> Option<Range> {
        if found.scalar_span().is_some() {
            return self.range_of(found);
        }
        match (self.bound(found, "min"), self.bound(found, "max")) {
            (Some(min), Some(max)) => Some(Range { min, max }),
            (Some(one), None) | (None, Some(one)) => Some(Range::fixed(one)),
            (None, None) => None,
        }
    }

    /// `key` below `node` as [`Self::initializer_range_of`] reads it.
    pub fn initializer_range_in(&self, node: &Node, key: &str) -> Option<Range> {
        self.initializer_range_of(node.find(key, &self.src)?)
    }

    /// The number `found`'s `key` bound writes.
    fn bound(&self, found: &Node, key: &str) -> Option<f64> {
        self.number_of(&self.written_in(found, key)?)
    }

    /// The definition's own `key` as a [`Range`].
    pub fn range(&self, key: &str) -> Option<Range> {
        self.range_in(&self.node, key)
    }

    /// Each `key = number` child of `node` in order, repeated keys summed; blocks and
    /// non-numeric values are left out.
    pub fn numbers(&self, node: &Node) -> Vec<(String, f64)> {
        let mut out: Vec<(String, f64)> = Vec::new();
        let children = node.children();
        for (at, child) in children.iter().enumerate() {
            let Some(key) = child.key_str(&self.src) else {
                continue;
            };
            let Some(amount) =
                written(children, at, &self.src).and_then(|text| self.number_of(&text))
            else {
                continue;
            };
            match out.iter_mut().find(|(k, _)| k == key) {
                Some(entry) => entry.1 += amount,
                None => out.push((key.to_owned(), amount)),
            }
        }
        out
    }
}

/// `children[at]`'s scalar value. Inline maths written with spaces, `@[ 4 * x ]`, parses as
/// `@[` and then one list item per word up to `]`, so those items are joined back onto it.
fn written<'a>(children: &[Node], at: usize, src: &'a [u8]) -> Option<Cow<'a, str>> {
    let first = children.get(at)?.scalar_str(src)?;
    if !first.starts_with("@[") || first.ends_with(']') {
        return Some(Cow::Borrowed(first));
    }
    let mut text = first.to_owned();
    for item in &children[at + 1..] {
        let Some(word) = item.key.map_or_else(|| item.scalar_str(src), |_| None) else {
            break;
        };
        text.push(' ');
        text.push_str(word);
        if word.ends_with(']') {
            return Some(Cow::Owned(text));
        }
    }
    Some(Cow::Borrowed(first))
}

/// Stellaris inline maths: numbers, variable names with or without `@`, `+ - * /`,
/// parentheses and unary minus.
mod maths {
    /// How deep parentheses and unary minus may nest.
    const MAX_DEPTH: usize = 64;

    #[derive(Clone, Copy)]
    enum Token<'a> {
        Number(f64),
        Name(&'a str),
        Op(u8),
    }

    /// `expr`'s value; `None` when it does not parse, names a variable `resolve` does not
    /// know, or is not finite.
    pub(super) fn evaluate(expr: &str, resolve: &dyn Fn(&str) -> Option<f64>) -> Option<f64> {
        let tokens = tokens(expr)?;
        let mut parser = Parser {
            tokens: &tokens,
            at: 0,
            resolve,
        };
        let value = parser.sum(0)?;
        (parser.at == tokens.len() && value.is_finite()).then_some(value)
    }

    fn tokens(expr: &str) -> Option<Vec<Token<'_>>> {
        let bytes = expr.as_bytes();
        let mut out = Vec::new();
        let mut at = 0;
        while let Some(&b) = bytes.get(at) {
            if b.is_ascii_whitespace() {
                at += 1;
                continue;
            }
            if matches!(b, b'+' | b'-' | b'*' | b'/' | b'(' | b')') {
                out.push(Token::Op(b));
                at += 1;
                continue;
            }
            let len = bytes[at..]
                .iter()
                .position(|&c| !(c.is_ascii_alphanumeric() || matches!(c, b'_' | b'.' | b'@')))
                .unwrap_or(bytes.len() - at);
            let word = &expr[at..at + len];
            let name = word.strip_prefix('@').unwrap_or(word);
            if name.is_empty() {
                return None;
            }
            out.push(match b {
                b'0'..=b'9' | b'.' => Token::Number(word.parse().ok()?),
                _ => Token::Name(name),
            });
            at += len;
        }
        Some(out)
    }

    struct Parser<'t, 'a> {
        tokens: &'t [Token<'a>],
        at: usize,
        resolve: &'t dyn Fn(&str) -> Option<f64>,
    }

    impl Parser<'_, '_> {
        fn sum(&mut self, depth: usize) -> Option<f64> {
            let mut value = self.product(depth)?;
            while let Some(op @ (b'+' | b'-')) = self.op() {
                self.at += 1;
                let rhs = self.product(depth)?;
                value = if op == b'+' { value + rhs } else { value - rhs };
            }
            Some(value)
        }

        fn product(&mut self, depth: usize) -> Option<f64> {
            let mut value = self.unary(depth)?;
            while let Some(op @ (b'*' | b'/')) = self.op() {
                self.at += 1;
                let rhs = self.unary(depth)?;
                value = if op == b'*' { value * rhs } else { value / rhs };
            }
            Some(value)
        }

        fn unary(&mut self, depth: usize) -> Option<f64> {
            if depth > MAX_DEPTH {
                return None;
            }
            let token = *self.tokens.get(self.at)?;
            self.at += 1;
            match token {
                Token::Number(n) => Some(n),
                Token::Name(name) => (self.resolve)(name),
                Token::Op(b'-') => Some(-self.unary(depth + 1)?),
                Token::Op(b'(') => {
                    let value = self.sum(depth + 1)?;
                    (self.op() == Some(b')')).then_some(())?;
                    self.at += 1;
                    Some(value)
                }
                Token::Op(_) => None,
            }
        }

        fn op(&self) -> Option<u8> {
            match self.tokens.get(self.at)? {
                Token::Op(op) => Some(*op),
                _ => None,
            }
        }
    }
}

/// A value the game draws between two bounds, both included; a fixed one has them equal.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Range {
    pub min: f64,
    pub max: f64,
}

impl Range {
    pub fn fixed(n: f64) -> Self {
        Self { min: n, max: n }
    }

    pub fn midpoint(self) -> f64 {
        (self.min + self.max) / 2.0
    }

    pub fn contains(self, n: f64) -> bool {
        self.min <= n && n <= self.max
    }
}

/// `n` rounded to a whole count, `0` below zero.
pub fn whole(n: f64) -> u32 {
    n.round().max(0.0) as u32
}

pub(crate) const VARIABLES_DIR: &str = "common/scripted_variables";

/// The `common/` dirs where the game keeps the first definition of a key it loads and
/// reports the later ones; every other dir keeps the last.
const FIRST_WINS: [&str; 2] = [VARIABLES_DIR, "common/solar_system_initializers"];

/// Which definition of a repeated key a directory keeps.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Keeps {
    First,
    Last,
}

impl Keeps {
    fn of(rel_dir: &str) -> Self {
        match FIRST_WINS.contains(&rel_dir) {
            true => Self::First,
            false => Self::Last,
        }
    }
}

/// `common/scripted_variables`: the `@name = value` scalars every script file can use.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Variables(BTreeMap<String, (PathBuf, Variable)>);

impl Variables {
    pub(crate) fn load(layout: &Layout, diagnostics: &mut Vec<Diagnostic>) -> Self {
        let keeps = Keeps::of(VARIABLES_DIR);
        let mut vars = BTreeMap::new();
        for file in layout.files_in(VARIABLES_DIR) {
            let Some((root, src)) = parse_file(&file, diagnostics) else {
                continue;
            };
            for (name, value) in root.children().iter().filter_map(|n| variable(n, &src)) {
                let (name, value) = (name.to_owned(), (file.clone(), value));
                match keeps {
                    Keeps::First => {
                        vars.entry(name).or_insert(value);
                    }
                    Keeps::Last => {
                        vars.insert(name, value);
                    }
                }
            }
        }
        Self(vars)
    }

    /// `name`'s value, `@` stripped from the name.
    pub fn get(&self, name: &str) -> Option<&str> {
        self.0.get(name).map(|(_, var)| var.value.as_str())
    }

    /// The file and line `name` is defined on, `@` stripped from the name.
    pub fn defined_at(&self, name: &str) -> Option<(&Path, u32)> {
        self.0
            .get(name)
            .map(|(file, var)| (file.as_path(), var.line))
    }

    pub fn len(&self) -> usize {
        self.0.len()
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

/// Parse every winning file of `rel_dir` in filename order and collect the
/// top-level keyed blocks. `@variables` are skipped; a file that fails to
/// parse contributes nothing and is reported. A repeated top-level key keeps
/// one block, the first or the last as [`Keeps`] has it for `rel_dir`; files
/// that repeat keys need [`ParsedDir::roots`].
pub fn parse_dir(
    layout: &Layout,
    rel_dir: &str,
    globals: &Arc<Variables>,
    diagnostics: &mut Vec<Diagnostic>,
) -> BTreeMap<String, Def> {
    ParsedDir::load(layout, rel_dir, diagnostics).into_defs(globals, diagnostics)
}

/// Every winning file of one directory in load order, each read and parsed once, so every
/// registry the directory feeds reads the same parse and a broken file is reported once.
pub(crate) struct ParsedDir {
    keeps: Keeps,
    files: Vec<(PathBuf, Node, Arc<[u8]>)>,
}

impl ParsedDir {
    pub(crate) fn load(layout: &Layout, rel_dir: &str, diagnostics: &mut Vec<Diagnostic>) -> Self {
        Self {
            keeps: Keeps::of(rel_dir),
            files: layout
                .files_in(rel_dir)
                .into_iter()
                .filter_map(|file| {
                    let (root, src) = parse_file(&file, diagnostics)?;
                    Some((file, root, src))
                })
                .collect(),
        }
    }

    /// Each file with its root block and bytes, in load order.
    pub(crate) fn files(&self) -> impl Iterator<Item = (&Path, &Node, &[u8])> {
        self.files
            .iter()
            .map(|(file, root, src)| (file.as_path(), root, &src[..]))
    }

    /// Each file's root block with its bytes, in load order.
    pub(crate) fn roots(&self) -> impl Iterator<Item = (&Node, &[u8])> {
        self.files.iter().map(|(_, root, src)| (root, &src[..]))
    }

    /// The top-level keyed blocks, as [`parse_dir`] collects them.
    pub(crate) fn into_defs(
        self,
        globals: &Arc<Variables>,
        diagnostics: &mut Vec<Diagnostic>,
    ) -> BTreeMap<String, Def> {
        let mut defs: BTreeMap<String, Def> = BTreeMap::new();
        for (file, root, src) in self.files {
            let Value::Block { children, .. } = root.value else {
                continue;
            };
            let vars = Arc::new(file_vars(&children, &src));
            for node in children {
                let Some(key) = node.key_str(&src) else {
                    continue;
                };
                if key.starts_with('@') || node.scalar_span().is_some() {
                    continue;
                }
                let def = Def {
                    node,
                    src: Arc::clone(&src),
                    file: file.clone(),
                    vars: Arc::clone(&vars),
                    globals: Arc::clone(globals),
                };
                let mut held = match defs.entry(key.to_owned()) {
                    Entry::Vacant(slot) => {
                        slot.insert(def);
                        continue;
                    }
                    Entry::Occupied(held) => held,
                };
                let earlier = held.get().file.clone();
                let (from, to) = match self.keeps {
                    Keeps::First => (file.clone(), earlier),
                    Keeps::Last => {
                        held.insert(def);
                        (earlier, file.clone())
                    }
                };
                // A key repeated within one file is the game's own idiom (`random_list` in
                // planet_classes), not a mod overriding anything, so it goes unreported.
                if from != to {
                    diagnostics.push(Diagnostic::Override {
                        key: key.to_owned(),
                        from,
                        to,
                    });
                }
            }
        }
        defs
    }
}

fn file_vars(children: &[Node], src: &[u8]) -> BTreeMap<String, Variable> {
    children
        .iter()
        .filter_map(|node| variable(node, src))
        .map(|(name, var)| (name.to_owned(), var))
        .collect()
}

/// An `@name = value` scalar as its name, `@` stripped, and value.
fn variable<'a>(node: &Node, src: &'a [u8]) -> Option<(&'a str, Variable)> {
    let name = node.key_str(src)?.strip_prefix('@')?;
    let var = Variable {
        value: node.scalar_str(src)?.to_owned(),
        line: line_of(src, node.span().start),
    };
    Some((name, var))
}

/// The line, from 1, that byte `offset` of `src` is on.
pub(crate) fn line_of(src: &[u8], offset: usize) -> u32 {
    let upto = offset.min(src.len());
    let lines = src[..upto].iter().filter(|&&b| b == b'\n').count();
    u32::try_from(lines + 1).unwrap_or(u32::MAX)
}

/// Parse one script file directly, for a caller whose layering is not the
/// "last file of this name wins" rule [`parse_dir`] applies (a single
/// well-known file, or a file whose top-level blocks repeat a key).
pub fn parse_file(file: &Path, diagnostics: &mut Vec<Diagnostic>) -> Option<(Node, Arc<[u8]>)> {
    let bytes: Arc<[u8]> = match fs::read(file) {
        Ok(bytes) => bytes.into(),
        Err(e) => {
            diagnostics.push(Diagnostic::Unreadable {
                file: file.to_path_buf(),
                reason: e.to_string(),
            });
            return None;
        }
    };
    match cst::parse_script(&bytes, 0) {
        Ok(root) => Some((root, bytes)),
        Err(e) => {
            diagnostics.push(Diagnostic::ParseError {
                file: file.to_path_buf(),
                offset: e.offset,
                reason: e.reason.to_owned(),
            });
            None
        }
    }
}

/// Every node named `key` at any depth below `node`, in file order.
pub fn find_deep<'n>(node: &'n Node, key: &str, src: &[u8], out: &mut Vec<&'n Node>) {
    for child in node.children() {
        if child.key_str(src) == Some(key) {
            out.push(child);
        }
        find_deep(child, key, src, out);
    }
}

/// The bare scalar items of a `key = { a b c }` list, over every such block.
pub fn list_items(node: &Node, key: &str, src: &[u8]) -> Vec<String> {
    node.find_all(key, src)
        .flat_map(|block| block.children())
        .filter(|item| item.key.is_none())
        .filter_map(|item| item.scalar_str(src))
        .map(str::to_owned)
        .collect()
}

/// The unquoted scalar value of the last direct child of `node` named `key`; empty counts as
/// none. Unlike [`Def::scalar`] (the first, for a definition's own fields), a later duplicate
/// overrides an earlier one: `.asset` entity lookups and `gfx/worldgfx` settings blocks rely
/// on this.
pub fn last_scalar<'a>(node: &Node, key: &str, src: &'a [u8]) -> Option<&'a str> {
    node.find_all(key, src)
        .last()?
        .scalar_str(src)
        .filter(|s| !s.is_empty())
}
