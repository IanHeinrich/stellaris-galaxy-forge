//! What a layout's body runs in its `init_effect` that the generator writes: deposit,
//! blocker, class, model and modifier changes, repeated by a `while` with a count or
//! chosen by an `if` on the DLC. Anomalies, flags, event targets and ambient objects are
//! dropped with the script; anything else makes the layout one the generator cannot build.

use sgf_core::cst::Node;
use sgf_core::ops::BodySpec;

use crate::GameData;
use crate::install::script::Def;

/// One statement of a body's `init_effect`, run on the body once its deposits are rolled.
#[derive(Debug, Clone, PartialEq)]
pub enum BodyEffect {
    /// `clear_deposits = yes`.
    ClearDeposits,
    /// `set_deposit = d_…`, which replaces the body's deposits.
    SetDeposit(String),
    /// `add_deposit = d_…`.
    AddDeposit(String),
    /// `clear_blockers = yes`: the deposits in a blocker category go.
    ClearBlockers,
    /// `add_blocker = { type = d_… }`.
    AddBlocker(String),
    /// `change_pc = pc_…`, with no `inherit_entity`: the body takes the class and its model.
    ChangeClass(String),
    /// `set_planet_entity = { entity = … }`.
    Entity(String),
    /// `add_modifier = { modifier = … }`.
    Modifier(String),
    /// `while = { count = n … }`.
    Repeat(u32, Vec<BodyEffect>),
    /// An `if`, its `else_if`s and its `else`: the first arm whose check holds runs, an
    /// `else` having none.
    Branch(Vec<(Option<Check>, Vec<BodyEffect>)>),
}

/// A condition an `if` or a layout's odds ask, as far as the generator can answer it.
#[derive(Debug, Clone, PartialEq)]
pub enum Check {
    /// `host_has_dlc = "…"`.
    HostDlc(String),
    /// `name = yes` or `no`, a scripted trigger the generator answers only when it checks a
    /// DLC.
    Trigger(String, bool),
    Not(Box<Check>),
    All(Vec<Check>),
    Any(Vec<Check>),
    /// Anything else: a cluster, the galaxy's setup, a neighbour, by its key.
    Unknown(String),
}

impl Check {
    /// The conditions of `block` but those keyed `skip`, all of which must hold.
    pub(crate) fn compile(block: &Node, def: &Def, skip: &[&str]) -> Self {
        Self::All(
            block
                .children()
                .iter()
                .filter(|c| c.key_str(&def.src).is_some_and(|key| !skip.contains(&key)))
                .map(|c| Self::of(c, def))
                .collect(),
        )
    }

    fn of(node: &Node, def: &Def) -> Self {
        let src = &def.src;
        let key = node.key_str(src).unwrap_or_default();
        match key {
            "host_has_dlc" => match node.scalar_str(src) {
                Some(dlc) => Self::HostDlc(dlc.to_owned()),
                None => Self::Unknown(key.to_owned()),
            },
            "AND" => Self::compile(node, def, &[]),
            "OR" => Self::Any(Self::compile_all(node, def)),
            "NOT" => Self::Not(Box::new(Self::compile(node, def, &[]))),
            "NOR" => Self::Not(Box::new(Self::Any(Self::compile_all(node, def)))),
            _ => match node.scalar_str(src) {
                Some("yes") => Self::Trigger(key.to_owned(), true),
                Some("no") => Self::Trigger(key.to_owned(), false),
                _ => Self::Unknown(key.to_owned()),
            },
        }
    }

    fn compile_all(node: &Node, def: &Def) -> Vec<Self> {
        node.children()
            .iter()
            .filter(|c| c.key_str(&def.src).is_some())
            .map(|c| Self::of(c, def))
            .collect()
    }

    /// `Some` when the check asks only about DLC, which `has_dlc` answers; `None` when it
    /// asks anything else.
    pub fn decide(&self, gd: &GameData, has_dlc: &dyn Fn(&str) -> bool) -> Option<bool> {
        match self {
            Self::HostDlc(dlc) => Some(has_dlc(dlc)),
            Self::Trigger(name, wanted) => {
                let dlc = gd.scripted_triggers.get(name)?.host_dlc.as_deref()?;
                Some(has_dlc(dlc) == *wanted)
            }
            Self::Not(inner) => inner.decide(gd, has_dlc).map(|held| !held),
            Self::All(checks) => checks
                .iter()
                .try_fold(true, |every, c| Some(every && c.decide(gd, has_dlc)?)),
            Self::Any(checks) => {
                let mut unknown = false;
                for check in checks {
                    match check.decide(gd, has_dlc) {
                        Some(true) => return Some(true),
                        Some(false) => {}
                        None => unknown = true,
                    }
                }
                (!unknown).then_some(false)
            }
            Self::Unknown(_) => None,
        }
    }

    /// Every DLC the check names, directly or through a trigger that checks one.
    pub(crate) fn dlcs(&self, gd: &GameData, out: &mut Vec<String>) {
        let named = match self {
            Self::HostDlc(dlc) => Some(dlc.clone()),
            Self::Trigger(name, _) => gd
                .scripted_triggers
                .get(name)
                .and_then(|t| t.host_dlc.clone()),
            Self::Not(inner) => return inner.dlcs(gd, out),
            Self::All(checks) | Self::Any(checks) => {
                return checks.iter().for_each(|c| c.dlcs(gd, out));
            }
            Self::Unknown(_) => None,
        };
        if let Some(dlc) = named
            && !out.contains(&dlc)
        {
            out.push(dlc);
        }
    }
}

/// Effects dropped with the script: anomalies, archaeology sites, event targets and events,
/// ambient objects and logging. Flags are matched by [`dropped`].
const DROPPED: [&str; 17] = [
    "prevent_anomaly",
    "add_anomaly",
    "create_archaeological_site",
    "save_event_target_as",
    "save_global_event_target_as",
    "country_event",
    "fleet_event",
    "planet_event",
    "fire_on_action",
    "create_ambient_object",
    "set_ambient_object_flag",
    "set_location",
    "spawn_debris",
    "set_spawn_system_batch",
    "reroll_random",
    "nebula_cloaking_effect",
    "log",
];
/// Keys inside an effect block that hold its conditions or parameters.
const CONDITIONS: [&str; 4] = ["limit", "trigger", "modifier", "count"];
/// Blocks whose effects run on the same body, as if written beside them.
const SAME_SCOPE: [&str; 1] = ["hidden_effect"];
/// Blocks that run their effects by chance or in turn, and scopes by name.
const FLOW: [&str; 3] = ["random_list", "IF", "effect"];
const SCOPES: [&str; 11] = [
    "prev",
    "prevprev",
    "root",
    "from",
    "fromfrom",
    "owner",
    "solar_system",
    "star",
    "capital_scope",
    "orbit",
    "this",
];

/// Flags on any scope but a country's, which only a spawned country would have.
fn dropped(key: &str) -> bool {
    DROPPED.contains(&key)
        || (key.starts_with("set_") && key.ends_with("_flag") && key != "set_country_flag")
        || key == "remove_global_flag"
}

fn scope(key: &str) -> bool {
    SCOPES.contains(&key)
        || key.starts_with("event_target:")
        || key.starts_with("last_created_")
        || (key != "random_deposit"
            && ["every_", "random_", "ordered_", "any_"]
                .iter()
                .any(|prefix| key.starts_with(prefix)))
}

fn nested(node: &Node, def: &Def) -> bool {
    node.scalar_str(&def.src).is_none() && !node.children().is_empty()
}

/// The first statement below `block` that is not dropped with the script, when there is
/// one: what a layout's own `init_effect`, or a scope or chance a body's changes to, runs.
pub(crate) fn undropped(block: &Node, def: &Def) -> Option<String> {
    for child in block.children() {
        let Some(key) = child.key_str(&def.src) else {
            continue;
        };
        if CONDITIONS.contains(&key) || dropped(key) {
            continue;
        }
        let walkable = FLOW.contains(&key)
            || SAME_SCOPE.contains(&key)
            || ["if", "else_if", "else", "while"].contains(&key)
            || scope(key)
            || key.parse::<f64>().is_ok();
        if nested(child, def) && walkable {
            match undropped(child, def) {
                Some(found) => return Some(found),
                None => continue,
            }
        }
        return Some(key.to_owned());
    }
    None
}

/// A body's `init_effect` blocks read in order: what they run that the generator writes,
/// and the first statement it can neither write nor drop.
pub(crate) fn read(body: &Node, def: &Def) -> (Vec<BodyEffect>, Option<String>) {
    let mut effects = Vec::new();
    let mut unwritten = None;
    for block in body.find_all("init_effect", &def.src) {
        read_block(block, def, &mut effects, &mut unwritten);
    }
    (effects, unwritten)
}

fn read_block(block: &Node, def: &Def, out: &mut Vec<BodyEffect>, unwritten: &mut Option<String>) {
    let src = &def.src;
    let children = block.children();
    let mut i = 0;
    while i < children.len() {
        let child = &children[i];
        i += 1;
        let Some(key) = child.key_str(src) else {
            continue;
        };
        if CONDITIONS.contains(&key) || dropped(key) {
            continue;
        }
        let scalar = child.scalar_str(src);
        let field = |name: &str| child.find(name, src).and_then(|n| n.scalar_str(src));
        let deposit = scalar.filter(|d| d.starts_with("d_")).map(str::to_owned);
        let effect = match key {
            "clear_deposits" => (scalar == Some("yes")).then_some(BodyEffect::ClearDeposits),
            "clear_blockers" => (scalar == Some("yes")).then_some(BodyEffect::ClearBlockers),
            "set_deposit" => deposit.map(BodyEffect::SetDeposit),
            "add_deposit" => deposit.map(BodyEffect::AddDeposit),
            "add_blocker" => field("type")
                .filter(|d| d.starts_with("d_"))
                .map(|d| BodyEffect::AddBlocker(d.to_owned())),
            "change_pc" => match scalar {
                Some(class) => Some(BodyEffect::ChangeClass(class.to_owned())),
                None if field("inherit_entity") == Some("yes") => None,
                None => field("class").map(|c| BodyEffect::ChangeClass(c.to_owned())),
            },
            "set_planet_entity" => field("entity").map(|e| BodyEffect::Entity(e.to_owned())),
            "add_modifier" => field("modifier").map(|m| BodyEffect::Modifier(m.to_owned())),
            "while" => repeat(child, def, unwritten),
            "if" => {
                let mut arms = vec![arm(child, def, true, unwritten)];
                while let Some(next) = children.get(i) {
                    match next.key_str(src) {
                        Some("else_if") => arms.push(arm(next, def, true, unwritten)),
                        Some("else") => arms.push(arm(next, def, false, unwritten)),
                        _ => break,
                    }
                    i += 1;
                }
                if arms.iter().all(|(_, effects)| effects.is_empty()) {
                    continue;
                }
                Some(BodyEffect::Branch(arms))
            }
            _ if SAME_SCOPE.contains(&key) && nested(child, def) => {
                read_block(child, def, out, unwritten);
                continue;
            }
            _ if nested(child, def) && (FLOW.contains(&key) || scope(key)) => {
                if let Some(found) = undropped(child, def) {
                    unwritten.get_or_insert(found);
                }
                continue;
            }
            _ => None,
        };
        match effect {
            Some(effect) => out.push(effect),
            None => {
                unwritten.get_or_insert_with(|| key.to_owned());
            }
        }
    }
}

fn repeat(node: &Node, def: &Def, unwritten: &mut Option<String>) -> Option<BodyEffect> {
    if node.find("limit", &def.src).is_some() {
        return None;
    }
    let count = node
        .find("count", &def.src)
        .and_then(|c| c.scalar_str(&def.src))
        .and_then(|text| def.number_of(text))?;
    let mut inner = Vec::new();
    read_block(node, def, &mut inner, unwritten);
    Some(BodyEffect::Repeat(count.max(0.0).round() as u32, inner))
}

fn arm(
    node: &Node,
    def: &Def,
    checked: bool,
    unwritten: &mut Option<String>,
) -> (Option<Check>, Vec<BodyEffect>) {
    let check = checked.then(|| match node.find("limit", &def.src) {
        Some(limit) => Check::compile(limit, def, &[]),
        None => Check::All(Vec::new()),
    });
    let mut effects = Vec::new();
    read_block(node, def, &mut effects, unwritten);
    (check, effects)
}

/// The first check of `effects` that asks more than DLC, by what it asks.
pub(crate) fn undecided(gd: &GameData, effects: &[BodyEffect]) -> Option<String> {
    effects.iter().find_map(|effect| match effect {
        BodyEffect::Repeat(_, inner) => undecided(gd, inner),
        BodyEffect::Branch(arms) => arms.iter().find_map(|(check, inner)| {
            check
                .as_ref()
                .filter(|c| c.decide(gd, &|_| true).is_none())
                .map(|_| "if".to_owned())
                .or_else(|| undecided(gd, inner))
        }),
        _ => None,
    })
}

/// Every planet modifier `effects` can add, in order, each once.
pub fn modifiers(effects: &[BodyEffect]) -> Vec<&str> {
    let mut out: Vec<&str> = Vec::new();
    collect_modifiers(effects, &mut out);
    out
}

fn collect_modifiers<'e>(effects: &'e [BodyEffect], out: &mut Vec<&'e str>) {
    for effect in effects {
        match effect {
            BodyEffect::Modifier(m) if !out.contains(&m.as_str()) => out.push(m),
            BodyEffect::Repeat(_, inner) => collect_modifiers(inner, out),
            BodyEffect::Branch(arms) => arms
                .iter()
                .for_each(|(_, inner)| collect_modifiers(inner, out)),
            _ => {}
        }
    }
}

/// Run `effects` on `body` in order, with `has_dlc` answering the `if`s.
pub(crate) fn apply(
    gd: &GameData,
    effects: &[BodyEffect],
    body: &mut BodySpec,
    has_dlc: &dyn Fn(&str) -> bool,
) {
    for effect in effects {
        match effect {
            BodyEffect::ClearDeposits => body.deposits.clear(),
            BodyEffect::SetDeposit(key) => {
                body.deposits.clear();
                body.deposits.push(key.clone());
            }
            BodyEffect::AddDeposit(key) | BodyEffect::AddBlocker(key) => {
                body.deposits.push(key.clone())
            }
            BodyEffect::ClearBlockers => body.deposits.retain(|d| !blocker(gd, d)),
            BodyEffect::ChangeClass(class) => body.class.clone_from(class),
            BodyEffect::Entity(entity) => body.entity_name = Some(entity.clone()),
            BodyEffect::Modifier(modifier) => {
                if !body.modifiers.contains(modifier) {
                    body.modifiers.push(modifier.clone());
                }
            }
            BodyEffect::Repeat(count, inner) => {
                for _ in 0..*count {
                    apply(gd, inner, body, has_dlc);
                }
            }
            BodyEffect::Branch(arms) => {
                let taken = arms.iter().find(|(check, _)| {
                    check
                        .as_ref()
                        .is_none_or(|c| c.decide(gd, has_dlc) == Some(true))
                });
                if let Some((_, inner)) = taken {
                    apply(gd, inner, body, has_dlc);
                }
            }
        }
    }
}

/// A deposit whose category is a blocker's, as the planet page and the roller read it.
pub fn blocker(gd: &GameData, deposit: &str) -> bool {
    gd.deposits
        .get(deposit)
        .and_then(|d| d.category.as_deref())
        .and_then(|category| gd.deposit_categories.get(category))
        .is_some_and(|category| category.blocker)
}
