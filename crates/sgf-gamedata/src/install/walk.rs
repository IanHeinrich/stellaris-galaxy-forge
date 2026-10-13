//! One walk of an effect block as the game runs it: each statement read with the parameters
//! of the scripted effect it stands in put in, `[[PARAM] … ]` blocks settled, the branches of
//! an `if`/`else_if`/`else` chain handed over one by one, and the scripted effects it calls
//! followed with their arguments, [`MAX_DEPTH`] calls deep. What a statement or a branch does
//! is up to the reader, a [`Visitor`].

use std::borrow::Cow;
use std::collections::HashSet;

use sgf_core::cst::Node;

use crate::install::inline_script::{Kept, kept_children, put_params_in};
use crate::install::script::{Def, Names, written, written_key};
use crate::scripts::ScriptIndex;

/// How deep scripted effects calling scripted effects are followed.
pub(crate) const MAX_DEPTH: usize = 8;

/// The blocks whose effects run only on a condition.
pub(crate) const CONDITIONAL: [&str; 4] = ["if", "else_if", "else", "switch"];

/// The text a walk reads: a file's bytes, the `@variables` it can name, and the parameters
/// the call that reached it passed.
#[derive(Clone)]
pub(crate) struct Script<'s> {
    src: &'s [u8],
    names: Names,
    params: Vec<(String, String)>,
    /// How many scripted-effect calls deep the walk is.
    depth: usize,
}

impl<'s> Script<'s> {
    pub(crate) fn of_def(def: &'s Def) -> Self {
        Self::of_file(&def.src, def.names())
    }

    /// A file's text that no call reached, such as an event's.
    pub(crate) fn of_file(src: &'s [u8], names: Names) -> Self {
        Self {
            src,
            names,
            params: Vec::new(),
            depth: 0,
        }
    }

    pub(crate) fn src(&self) -> &'s [u8] {
        self.src
    }

    pub(crate) fn names(&self) -> &Names {
        &self.names
    }

    /// `text` with the parameters put in.
    pub(crate) fn put<'t>(&self, text: &'t str) -> Cow<'t, str> {
        put_params_in(text, &self.params)
    }

    pub(crate) fn key(&self, node: &Node) -> Option<Cow<'s, str>> {
        Some(self.put(node.key_str(self.src)?))
    }

    /// `node`'s scalar value; `None` for a block.
    pub(crate) fn value(&self, node: &Node) -> Option<Cow<'s, str>> {
        Some(self.put(node.scalar_str(self.src)?))
    }

    /// The scalar value of the first child of `node` named `name`.
    pub(crate) fn field(&self, node: &Node, name: &str) -> Option<String> {
        Some(self.value(node.find(name, self.src)?)?.into_owned())
    }

    /// The scalar value of the first child of `node` named `name`, its inline maths written
    /// with spaces read whole.
    pub(crate) fn written(&self, node: &Node, name: &str) -> Option<String> {
        Some(self.put(&written_key(node, name, self.src)?).into_owned())
    }

    /// The first child of `node` named `name` as a number, as [`Self::number_of`] reads it.
    pub(crate) fn number(&self, node: &Node, name: &str) -> Option<f64> {
        self.number_of(&self.written(node, name)?)
    }

    /// A number as written, an `@variable` the file names or inline maths.
    pub(crate) fn number_of(&self, text: &str) -> Option<f64> {
        self.names.number_of(text)
    }

    /// The children of `node` its `[[PARAM] … ]` blocks keep.
    pub(crate) fn children<'n>(&self, node: &'n Node) -> Vec<Kept<'n>> {
        kept_children(node, self.src, &self.params)
    }

    /// The scalar value of a kept child, without the brackets that close blocks.
    pub(crate) fn kept_value(&self, kept: &Kept<'_>) -> Option<Cow<'s, str>> {
        Some(self.put(kept.value(self.src)?))
    }

    /// The text of scripted effect `effect` as call `call` reaches it: `name = yes`, or
    /// `name = { PARAM = value … }` passing parameters. `None` once the walk is
    /// [`MAX_DEPTH`] calls deep.
    pub(crate) fn call<'e>(&self, effect: &'e Def, call: &Node) -> Option<Script<'e>> {
        if self.depth >= MAX_DEPTH {
            return None;
        }
        let args = call.children();
        let params = (0..args.len())
            .filter_map(|at| {
                let name = args[at].key_str(self.src)?;
                let value = written(args, at, self.src)?;
                Some((name.to_owned(), self.put(&value).into_owned()))
            })
            .collect();
        Some(Script {
            src: &effect.src,
            names: effect.names(),
            params,
            depth: self.depth + 1,
        })
    }
}

/// Whether the rest of a block runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Flow {
    Go,
    /// `break = yes`: the rest of the hook does not run.
    Break,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Branch {
    If,
    ElseIf,
    Else,
}

/// One statement of a block that is no branch, its key and value with the parameters put in.
pub(crate) struct Statement<'a> {
    pub key: &'a str,
    pub value: Option<&'a str>,
    pub node: &'a Node,
}

/// A reader of what a walk meets.
pub(crate) trait Visitor {
    /// Where the walk stands for this reader: its scope, and what guards it.
    type At;
    /// What the earlier branches of an `if` chain leave for the next. An `if` starts afresh.
    type Chain: Default;

    fn branch(
        &mut self,
        script: &Script<'_>,
        at: &Self::At,
        branch: Branch,
        node: &Node,
        chain: &mut Self::Chain,
    ) -> Flow;

    fn statement(&mut self, script: &Script<'_>, at: &Self::At, statement: Statement<'_>) -> Flow;
}

/// Hand each statement of `node` that its parameter blocks keep to `visitor`, in order, until
/// one breaks.
pub(crate) fn block<V: Visitor>(
    visitor: &mut V,
    script: &Script<'_>,
    at: &V::At,
    node: &Node,
) -> Flow {
    let mut chain = V::Chain::default();
    for kept in script.children(node) {
        let child = kept.node;
        let Some(key) = script.key(child) else {
            continue;
        };
        let branch = match key.as_ref() {
            "if" => {
                chain = V::Chain::default();
                Some(Branch::If)
            }
            "else_if" => Some(Branch::ElseIf),
            "else" => Some(Branch::Else),
            _ => None,
        };
        let flow = match branch {
            Some(branch) => visitor.branch(script, at, branch, child, &mut chain),
            None => {
                let value = script.kept_value(&kept);
                let statement = Statement {
                    key: &key,
                    value: value.as_deref(),
                    node: child,
                };
                visitor.statement(script, at, statement)
            }
        };
        if flow == Flow::Break {
            return Flow::Break;
        }
    }
    Flow::Go
}

/// Walk the scripted effect `key` names, when it names one and the walk is less than
/// [`MAX_DEPTH`] calls deep; `false` when it does not.
pub(crate) fn follow<V: Visitor>(
    visitor: &mut V,
    scripts: &ScriptIndex,
    script: &Script<'_>,
    at: &V::At,
    key: &str,
    call: &Node,
) -> bool {
    let Some(effect) = scripts.effect(key) else {
        return false;
    };
    let Some(inner) = script.call(effect, call) else {
        return false;
    };
    block(visitor, &inner, at, &effect.node);
    true
}

/// What a [`scan`] does after a statement.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Scan {
    /// Follow the scripted effect it names, or else scan the block it holds.
    Enter,
    /// Go on with the next statement.
    Skip,
    /// Scan nothing more.
    Stop,
}

impl Branch {
    pub(crate) fn key(self) -> &'static str {
        match self {
            Self::If => "if",
            Self::ElseIf => "else_if",
            Self::Else => "else",
        }
    }
}

/// Hand every statement below `node` to `each`, in order, a branch of an `if` chain as a
/// statement keyed `if`, `else_if` or `else`, and go where it says. A scripted effect a
/// statement names is followed only when `scripts` is given, and only the first time it is
/// called with the same parameters.
pub(crate) fn scan(
    script: &Script<'_>,
    node: &Node,
    scripts: Option<&ScriptIndex>,
    each: &mut dyn FnMut(&Statement<'_>) -> Scan,
) {
    let mut scanner = Scanner {
        scripts,
        each,
        followed: HashSet::new(),
        stopped: false,
    };
    block(&mut scanner, script, &(), node);
}

struct Scanner<'a, 'f> {
    scripts: Option<&'a ScriptIndex>,
    each: &'f mut dyn FnMut(&Statement<'_>) -> Scan,
    /// Each scripted effect followed, with the parameters it was given.
    followed: HashSet<(String, Vec<(String, String)>)>,
    stopped: bool,
}

impl Scanner<'_, '_> {
    fn visit(&mut self, script: &Script<'_>, statement: Statement<'_>) -> Flow {
        match (self.each)(&statement) {
            Scan::Stop => self.stopped = true,
            Scan::Skip => {}
            Scan::Enter => {
                let node = statement.node;
                let called = self
                    .scripts
                    .and_then(|scripts| scripts.effect(statement.key))
                    .and_then(|effect| Some((effect, script.call(effect, node)?)));
                match called {
                    Some((effect, inner)) => {
                        let call = (statement.key.to_owned(), inner.params.clone());
                        if self.followed.insert(call) {
                            block(self, &inner, &(), &effect.node);
                        }
                    }
                    None if node.scalar_span().is_none() => {
                        block(self, script, &(), node);
                    }
                    None => {}
                }
            }
        }
        match self.stopped {
            true => Flow::Break,
            false => Flow::Go,
        }
    }
}

impl Visitor for Scanner<'_, '_> {
    type At = ();
    type Chain = ();

    fn branch(
        &mut self,
        script: &Script<'_>,
        _: &(),
        branch: Branch,
        node: &Node,
        _: &mut (),
    ) -> Flow {
        let statement = Statement {
            key: branch.key(),
            value: None,
            node,
        };
        self.visit(script, statement)
    }

    fn statement(&mut self, script: &Script<'_>, _: &(), statement: Statement<'_>) -> Flow {
        self.visit(script, statement)
    }
}

/// The key of each `key = yes` below `node`: the scripted effects or triggers it calls,
/// among others.
pub(crate) fn calls(node: &Node, src: &[u8], out: &mut Vec<String>) {
    for child in node.children() {
        match (child.key_str(src), child.scalar_str(src)) {
            (Some(key), Some("yes")) => out.push(key.to_owned()),
            _ => calls(child, src, out),
        }
    }
}

/// `what` said as an unfollowed line of `origin`, the stage, event or effect the walk is in.
pub(crate) fn line(origin: &str, what: &str) -> String {
    format!("{origin}: {what}")
}

/// Add `line` to `lines` unless it is listed.
pub(crate) fn once(lines: &mut Vec<String>, line: String) {
    if !lines.contains(&line) {
        lines.push(line);
    }
}
