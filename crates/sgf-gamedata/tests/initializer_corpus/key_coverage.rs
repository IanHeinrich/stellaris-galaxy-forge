//! Whether the initializer reader keeps every statement of a block: each one is read into a
//! field of the details' `SystemSpawn` or `BodySpawn`, or sits as written in their raw lists.
//!
//! The walk goes over the block as the game reads it, inline scripts spliced in, at system
//! level, in the system's `init_effect`, in every `planet` and `moon` block at any depth and
//! in their `init_effect`s. A statement counts as read only in the shape the reader takes it
//! in, so the shape lists below follow `stated.rs`, `initializers.rs` and `details.rs`.

use std::collections::{BTreeMap, HashSet};

use sgf_core::cst::Node;
use sgf_core::format::save::details::{BodySpawn, RawStatement, SystemDetails, VariableUse};
use sgf_core::span::Span;
use sgf_gamedata::install::script::{Def, Range, whole};

/// Rows of a raw-key table.
const TOP: usize = 20;
/// Longest first line of a statement the output shows.
const LINE: usize = 120;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Scope {
    System,
    SystemEffect,
    Body,
    BodyEffect,
}

impl Scope {
    fn label(self) -> &'static str {
        match self {
            Self::System => "system",
            Self::SystemEffect => "system init_effect",
            Self::Body => "body",
            Self::BodyEffect => "body init_effect",
        }
    }

    /// The raw list the reader keeps a statement of this scope in.
    fn raw_list(self) -> &'static str {
        match self {
            Self::System => "system other_keys",
            Self::SystemEffect => "system script",
            Self::Body => "body other_keys",
            Self::BodyEffect => "body script",
        }
    }

    /// Only a block's own keys are recorded as `@variable` uses, not its effects'.
    fn records_variables(self) -> bool {
        matches!(self, Self::System | Self::Body)
    }
}

/// Where the initializer being checked comes from.
pub struct Context<'a> {
    pub source: &'a str,
    pub initializer: &'a str,
    pub file: &'a str,
}

pub struct Dropped {
    pub source: String,
    pub initializer: String,
    pub file: String,
    pub scope: &'static str,
    pub key: String,
    /// Which copy of its block the details miss it on; 0 for the system.
    pub copy: u32,
    pub line: String,
}

#[derive(Default)]
pub struct Coverage {
    pub statements: usize,
    pub read: usize,
    pub by_variable: usize,
    pub raw: usize,
    pub dropped: Vec<Dropped>,
    /// The details disagree with the walk about what the block holds.
    pub problems: Vec<String>,
    raw_keys: BTreeMap<(&'static str, String), usize>,
}

impl Coverage {
    pub fn merge(&mut self, other: Self) {
        self.statements += other.statements;
        self.read += other.read;
        self.by_variable += other.by_variable;
        self.raw += other.raw;
        self.dropped.extend(other.dropped);
        self.problems.extend(other.problems);
        for (key, count) in other.raw_keys {
            *self.raw_keys.entry(key).or_default() += count;
        }
    }

    /// The counts of `title`, then its raw keys by count.
    pub fn print_raw_keys(&self, title: &str) {
        println!(
            "{title}: {} statements, {} read, {} by variable, {} raw, {} dropped",
            self.statements,
            self.read,
            self.by_variable,
            self.raw,
            self.dropped.len()
        );
        let mut rows: Vec<_> = self.raw_keys.iter().collect();
        rows.sort_by(|a, b| b.1.cmp(a.1).then(a.0.cmp(b.0)));
        for ((list, key), count) in rows.iter().take(TOP) {
            println!("  {count:>8}  {list:<18} {key}");
        }
        if rows.len() > TOP {
            println!("  {:>8}  more keys", rows.len() - TOP);
        }
    }

    /// The dropped statements by scope and key with the first of each, then the first `shown`
    /// of them all.
    pub fn print_dropped(&self, shown: usize) {
        println!("{} dropped statements", self.dropped.len());
        let mut by_key: BTreeMap<(&str, &str), (usize, &Dropped)> = BTreeMap::new();
        for d in &self.dropped {
            by_key.entry((d.scope, d.key.as_str())).or_insert((0, d)).0 += 1;
        }
        let mut rows: Vec<_> = by_key.into_iter().collect();
        rows.sort_by(|a, b| b.1.0.cmp(&a.1.0).then(a.0.cmp(&b.0)));
        for ((scope, key), (count, first)) in rows.iter().take(TOP) {
            println!("  {count:>8}  {scope:<18} {key}");
            println!("            first: {}", first.describe());
        }
        for d in self.dropped.iter().take(shown) {
            println!("dropped: {}", d.describe());
        }
    }
}

impl Dropped {
    fn describe(&self) -> String {
        let copy = match self.copy {
            0 => String::new(),
            n => format!(" copy {n}"),
        };
        format!(
            "{} | {} | {} | {}{copy} | {} | {}",
            self.source, self.initializer, self.file, self.scope, self.key, self.line
        )
    }
}

/// The raw statements a spawn lists, each taken once by the statement that matches it.
struct Kept<'a> {
    other_keys: &'a [RawStatement],
    script: &'a [RawStatement],
    variables: &'a [VariableUse],
    other_used: Vec<bool>,
    script_used: Vec<bool>,
}

impl<'a> Kept<'a> {
    fn new(
        other_keys: &'a [RawStatement],
        script: &'a [RawStatement],
        variables: &'a [VariableUse],
    ) -> Self {
        Self {
            other_keys,
            script,
            variables,
            other_used: vec![false; other_keys.len()],
            script_used: vec![false; script.len()],
        }
    }

    fn take(&mut self, scope: Scope, key: &str, text: &str) -> bool {
        let (list, used) = match scope {
            Scope::System | Scope::Body => (self.other_keys, &mut self.other_used),
            Scope::SystemEffect | Scope::BodyEffect => (self.script, &mut self.script_used),
        };
        let found = list
            .iter()
            .zip(used.iter_mut())
            .find(|(raw, used)| !**used && raw.key == key && raw.text == text);
        match found {
            Some((_, used)) => {
                *used = true;
                true
            }
            None => false,
        }
    }

    fn variable(&self, key: &str) -> bool {
        self.variables.iter().any(|v| {
            v.key == key
                || v.key
                    .strip_prefix(key)
                    .is_some_and(|rest| rest.starts_with('.'))
        })
    }

    /// The keys of the raw statements nothing in the block matched.
    fn unmatched(&self) -> Vec<&'a str> {
        let unused = |list: &'a [RawStatement], used: &[bool]| {
            list.iter()
                .zip(used)
                .filter(|(_, used)| !**used)
                .map(|(raw, _)| raw.key.as_str())
                .collect::<Vec<_>>()
        };
        let mut keys = unused(self.other_keys, &self.other_used);
        keys.extend(unused(self.script, &self.script_used));
        keys
    }
}

/// One body of the expanded planet list: the block it is a copy of, and which copy.
struct Instance<'n> {
    node: &'n Node,
    copy: u32,
}

struct Walk<'a> {
    def: &'a Def,
    context: &'a Context<'a>,
    out: &'a mut Coverage,
    /// The system's starbase: the first `create_starbase` that states a `size`.
    starbase: Option<Span>,
    counted: HashSet<usize>,
    reported: HashSet<usize>,
}

/// Checks that every statement of `def`, the block of the initializer `details` was read
/// from, is read or kept as written by `details`.
pub fn check(def: &Def, details: &SystemDetails, context: &Context, out: &mut Coverage) {
    let name = format!("{}: {}", context.source, context.initializer);
    let Some(spawn) = &details.spawn else {
        out.problems
            .push(format!("{name}: the details hold no spawn"));
        return;
    };
    let mut walk = Walk {
        def,
        context,
        out,
        starbase: read_starbase(&def.node, &def.src),
        counted: HashSet::new(),
        reported: HashSet::new(),
    };

    let mut kept = Kept::new(&spawn.other_keys, &spawn.script, &spawn.variables);
    walk.block(&def.node, Scope::System, &mut kept, 0);
    walk.unmatched(&kept, Scope::System, 0);

    let mut instances = Vec::new();
    expand(def, &def.node, &["planet"], &mut instances);
    if instances.len() != details.planets.len() {
        walk.out.problems.push(format!(
            "{name}: the block expands to {} bodies, the details list {}",
            instances.len(),
            details.planets.len()
        ));
        return;
    }
    for (instance, planet) in instances.iter().zip(&details.planets) {
        let Some(body) = &planet.spawn else {
            walk.out
                .problems
                .push(format!("{name}: a body's details hold no spawn"));
            continue;
        };
        walk.body(instance, body);
    }
}

impl Walk<'_> {
    fn body(&mut self, instance: &Instance, spawn: &BodySpawn) {
        let mut kept = Kept::new(&spawn.other_keys, &spawn.script, &spawn.variables);
        self.block(instance.node, Scope::Body, &mut kept, instance.copy);
        self.unmatched(&kept, Scope::Body, instance.copy);
    }

    /// The statements of `node`, and of each `init_effect` among them.
    fn block(&mut self, node: &Node, scope: Scope, kept: &mut Kept, copy: u32) {
        let effects = match scope {
            Scope::System => Scope::SystemEffect,
            _ => Scope::BodyEffect,
        };
        for child in node.children() {
            self.statement(scope, child, kept, copy);
            if child.key_str(&self.def.src) == Some("init_effect") {
                for effect in child.children() {
                    self.statement(effects, effect, kept, copy);
                }
            }
        }
    }

    fn statement(&mut self, scope: Scope, node: &Node, kept: &mut Kept, copy: u32) {
        let def = self.def;
        let src = &def.src;
        let start = node.span().start;
        let first = self.counted.insert(start);
        let key = node.key_str(src);
        let text = String::from_utf8_lossy(node.span().slice(src)).into_owned();

        let read = key.is_some_and(|key| match scope {
            Scope::System => system_key_read(def, key, node),
            Scope::SystemEffect => system_effect_read(def, key, node, self.starbase),
            Scope::Body => body_key_read(def, key, node),
            Scope::BodyEffect => body_effect_read(def, key, node),
        });
        let by_variable =
            !read && scope.records_variables() && key.is_some_and(|key| kept.variable(key));
        let raw = !read && !by_variable && key.is_some_and(|key| kept.take(scope, key, &text));

        if first {
            self.out.statements += 1;
            if read {
                self.out.read += 1;
            } else if by_variable {
                self.out.by_variable += 1;
            } else if raw {
                self.out.raw += 1;
                let key = key.unwrap_or_default().to_owned();
                *self
                    .out
                    .raw_keys
                    .entry((scope.raw_list(), key))
                    .or_default() += 1;
            }
        }
        if !(read || by_variable || raw) && self.reported.insert(start) {
            self.out.dropped.push(Dropped {
                source: self.context.source.to_owned(),
                initializer: self.context.initializer.to_owned(),
                file: self.context.file.to_owned(),
                scope: scope.label(),
                key: key.unwrap_or("(no key)").to_owned(),
                copy,
                line: first_line(&text),
            });
        }
    }

    /// A raw statement the details list that no statement of the block matched means the
    /// walk and the reader disagree about the block.
    fn unmatched(&mut self, kept: &Kept, scope: Scope, copy: u32) {
        let unmatched = kept.unmatched();
        if !unmatched.is_empty() {
            self.out.problems.push(format!(
                "{}: {}: the {} details of copy {copy} list {} raw statements the block does not hold: {}",
                self.context.source,
                self.context.initializer,
                scope.label(),
                unmatched.len(),
                unmatched.join(", ")
            ));
        }
    }
}

fn first_line(text: &str) -> String {
    text.lines()
        .next()
        .unwrap_or_default()
        .trim()
        .chars()
        .take(LINE)
        .collect()
}

/// Every body the `keys` blocks below `parent` expand to, in the order the details list them:
/// each copy of a block up to the most its `count` allows, then that copy's moons. A spacer
/// (`class = none`) gives none.
fn expand<'n>(def: &Def, parent: &'n Node, keys: &[&str], out: &mut Vec<Instance<'n>>) {
    let src = &def.src;
    for block in parent.children() {
        if !block.key_str(src).is_some_and(|key| keys.contains(&key)) {
            continue;
        }
        let class = block
            .find("class", src)
            .and_then(|n| n.scalar_str(src))
            .unwrap_or("random");
        if class == "none" {
            continue;
        }
        // `InitPlanet::count`: a star spawns one whatever its `count` says.
        let count = match class {
            "star" => Range::fixed(1.0),
            _ => def
                .initializer_range_in(block, "count")
                .unwrap_or(Range::fixed(1.0)),
        };
        let min = whole(count.min.min(count.max));
        let max = whole(count.max).max(min);
        for copy in 1..=max {
            out.push(Instance { node: block, copy });
            expand(def, block, &["moon", "planet"], out);
        }
    }
}

/// The first `create_starbase` below `node`, a body's aside, when it states a `size`:
/// `stated::read_starbase`.
fn read_starbase(node: &Node, src: &[u8]) -> Option<Span> {
    let first = first_below(node, "create_starbase", src)?;
    first
        .find("size", src)
        .and_then(|n| n.scalar_str(src))
        .map(|_| first.span())
}

fn first_below<'n>(node: &'n Node, key: &str, src: &[u8]) -> Option<&'n Node> {
    node.children()
        .iter()
        .find_map(|child| match child.key_str(src) {
            Some("planet" | "moon") => None,
            Some(found) if found == key => Some(child),
            _ => first_below(child, key, src),
        })
}

/// A block whose items are all bare scalars: `stated::items`.
fn items_only(node: &Node) -> bool {
    node.scalar_span().is_none()
        && node
            .children()
            .iter()
            .all(|item| item.key.is_none() && item.scalar_span().is_some())
}

fn yes_or_no(scalar: Option<&str>) -> bool {
    matches!(scalar, Some("yes" | "no"))
}

/// `Def::initializer_range_of` of this statement: `key = n`, or a block with a `min`, a `max`
/// or both, `@variable`s resolved.
fn range_read(def: &Def, node: &Node) -> bool {
    def.initializer_range_of(node).is_some()
}

fn number_read(def: &Def, node: &Node) -> bool {
    node.scalar_str(&def.src)
        .and_then(|text| def.number_of(text))
        .is_some()
}

/// A key of the initializer's own block, in the shape the reader takes it in.
fn system_key_read(def: &Def, key: &str, node: &Node) -> bool {
    let src = &def.src;
    let scalar = node.scalar_str(src);
    let block = node.scalar_span().is_none();
    match key {
        // `Initializer::read_spliced`: `display_name`, `class`, `usage`; `stated::system`:
        // `namelist`. The name is shown by the initializer browser, not by the details.
        "name" | "class" | "usage" | "namelist" => scalar.is_some(),
        // `Initializer::read_spliced`: `max_instances` is read when it parses as a count.
        "max_instances" => scalar.is_some_and(|s| s.parse::<u32>().is_ok()),
        // `initializers::bodies`: the ranges of `change_orbit` before each `planet`, summed.
        "change_orbit" => range_read(def, node),
        // `stated::system`: the numbers `spawn_chance`, `scaled_spawn_chance` and the offsets.
        "spawn_chance" | "scaled_spawn_chance" | "inner_radius_offset" | "outer_radius_offset" => {
            number_read(def, node)
        }
        // `stated::system`: read as true when `yes`; `no` states nothing to keep.
        "prevent_anomalies" | "primitive_system" => yes_or_no(scalar),
        // `script::list_items`: `flags` is a block of bare items.
        "flags" => items_only(node),
        // `initializers::bodies`, and `stated::system` for its `init_effect`.
        "planet" | "init_effect" => block,
        // `stated::usage_odds`: a number, an unknown scalar or a block, each kept.
        "usage_odds" => true,
        // `stated::neighbor`: needs its `initializer`.
        "neighbor_system" => node
            .find("initializer", src)
            .and_then(|n| n.scalar_str(src))
            .is_some(),
        // `generate::belt`: needs a `type` and a `radius` that is a number or a range.
        "asteroid_belt" => {
            node.find("type", src)
                .and_then(|n| n.scalar_str(src))
                .is_some_and(|kind| !kind.is_empty())
                && def.initializer_range_in(node, "radius").is_some()
        }
        _ => false,
    }
}

/// A statement of the system's `init_effect`, in the shape `stated::system_effects` reads.
fn system_effect_read(def: &Def, key: &str, node: &Node, starbase: Option<Span>) -> bool {
    let src = &def.src;
    let has = |field: &str| {
        node.find(field, src)
            .and_then(|n| n.scalar_str(src))
            .is_some()
    };
    match key {
        "set_star_flag" | "create_archaeological_site" => node.scalar_str(src).is_some(),
        "create_ambient_object" | "spawn_megastructure" => has("type"),
        "create_starbase" => starbase == Some(node.span()),
        _ => false,
    }
}

/// A key of a `planet` or `moon` block, in the shape the reader takes it in.
fn body_key_read(def: &Def, key: &str, node: &Node) -> bool {
    let scalar = node.scalar_str(&def.src);
    let block = node.scalar_span().is_none();
    match key {
        // `initializers::body`: `name`, `class`, `entity`; `stated::body`: `modifier`,
        // `anomaly`.
        "name" | "class" | "entity" | "modifier" | "anomaly" => scalar.is_some(),
        // `initializers::body`: `Def::initializer_range_in`.
        "size" | "orbit_distance" | "count" => range_read(def, node),
        // `initializers::body`: `random` is read as any angle.
        "orbit_angle" => scalar == Some("random") || range_read(def, node),
        // `initializers::bodies`: the ranges of `change_orbit` before each moon, summed.
        "change_orbit" => range_read(def, node),
        // `initializers::body`: `has_ring`; `stated::body`: `home_planet`, `starting_planet`.
        "has_ring" | "home_planet" | "starting_planet" => yes_or_no(scalar),
        // `stated::body`: `deposit_blockers = none`, `modifiers = none`.
        "deposit_blockers" | "modifiers" => scalar == Some("none"),
        // `stated::items`.
        "flags" => items_only(node),
        // `stated::body` reads the `init_effect`; `initializers::bodies` the moons.
        "init_effect" | "moon" | "planet" => block,
        _ => false,
    }
}

/// A statement of a body's `init_effect`, in the shape `stated::body_effect` reads.
fn body_effect_read(def: &Def, key: &str, node: &Node) -> bool {
    let src = &def.src;
    let scalar = node.scalar_str(src);
    let field = |name: &str| node.find(name, src).and_then(|n| n.scalar_str(src));
    match key {
        "add_deposit"
        | "set_deposit"
        | "set_planet_flag"
        | "set_star_flag"
        | "create_archaeological_site" => scalar.is_some(),
        "clear_deposits" => scalar.is_some() || field("category").is_some(),
        "add_blocker" => field("type").or(scalar).is_some(),
        "clear_blockers" | "clear_planet_modifiers" | "prevent_anomaly" => true,
        "add_modifier" => field("modifier").is_some(),
        "set_name" => scalar.or_else(|| field("key")).is_some(),
        "set_planet_entity" => field("entity").or_else(|| field("picture")).is_some(),
        "change_pc" => scalar.or_else(|| field("class")).is_some(),
        "set_planet_size" => scalar.and_then(|s| def.number_of(s)).is_some(),
        "add_anomaly" => field("category").or(scalar).is_some(),
        "create_ambient_object" => field("type").is_some(),
        _ => false,
    }
}
