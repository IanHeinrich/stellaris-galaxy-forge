//! The bypasses an initializer's own effects spawn: which of them land on
//! the system it generates, what the `link_wormholes` beside each names as
//! the far end, and how many pairs it leaves the game to place.

use std::collections::VecDeque;

use sgf_core::cst::Node;

use crate::condition::Condition;
use crate::scripts::claims;
use crate::scripts::scope::{Scopes, is_guard};
use crate::scripts::view::BypassKind;

/// A bypass the initializer spawns on the system it generates, and what
/// the `link_wormholes` beside it names as the far end.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InitBypass {
    pub kind: BypassKind,
    pub partner: PartnerRef,
}

/// What an initializer's own effects spawn.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct InitBypasses {
    /// Endpoints on the system the initializer generates, in file order.
    pub own: Vec<InitBypass>,
    /// Wormhole pairs it leaves the game to place, neither end its own.
    pub random_wormhole_pairs: u32,
    /// Gateways it leaves the game to place.
    pub random_gateways: u32,
}

/// The far end of an initializer's wormhole, as the chain writes it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PartnerRef {
    /// Nothing links the endpoint to another system.
    None,
    /// An `event_target:` token, to resolve against the chains that saved it.
    Saved(String),
    /// The link is made in a scope that picked its system at random.
    Random,
}

/// Which system a statement of an initializer's effects runs on.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
enum InitSite {
    /// The system the initializer generates.
    Own,
    /// A scope that picked its system without naming a star flag.
    Random,
    /// An `event_target:` scope, to resolve against the chains.
    Target(String),
    /// A scope this reader cannot follow.
    #[default]
    Unknown,
}

/// One `spawn_natural_wormhole` or gateway `spawn_megastructure`.
struct Spawn {
    kind: BypassKind,
    site: InitSite,
    /// The site the `link_wormholes` following it in the same scope names.
    far: Option<InitSite>,
}

/// The bypasses the initializer's own effects spawn, each on the system the
/// scope it is written in runs on.
pub(crate) fn bypasses(node: &Node, src: &[u8]) -> InitBypasses {
    let mut spawns = Vec::new();
    collect(node, src, &Scopes::new(InitSite::Own), &mut spawns);

    // Every spawn elsewhere that links back here is the far end of one
    // endpoint, and of one only: two of them are two pairs.
    let mut back: VecDeque<InitSite> = spawns
        .iter()
        .filter(|spawn| spawn.far.as_ref() == Some(&InitSite::Own))
        .map(|spawn| spawn.site.clone())
        .collect();

    let mut found = InitBypasses::default();
    for spawn in &spawns {
        if spawn.site != InitSite::Own {
            match (&spawn.far, spawn.kind.is_wormhole()) {
                // Both ends elsewhere: the game places the pair.
                (Some(far), true) if *far != InitSite::Own => found.random_wormhole_pairs += 1,
                (_, true) => {}
                (_, false) => found.random_gateways += 1,
            }
            continue;
        }
        let far = spawn.far.clone().or_else(|| back.pop_front());
        found.own.push(InitBypass {
            kind: spawn.kind.clone(),
            partner: partner_ref(far),
        });
    }
    found
}

fn partner_ref(far: Option<InitSite>) -> PartnerRef {
    match far {
        None | Some(InitSite::Own) => PartnerRef::None,
        Some(InitSite::Target(token)) => PartnerRef::Saved(token),
        Some(InitSite::Random | InitSite::Unknown) => PartnerRef::Random,
    }
}

fn collect(node: &Node, src: &[u8], scopes: &Scopes<InitSite>, spawns: &mut Vec<Spawn>) {
    let here = scopes.here();
    // The spawn a `link_wormholes` of this scope speaks for.
    let mut last: Option<usize> = None;
    for child in node.children() {
        let Some(key) = child.key_str(src) else {
            collect(child, src, scopes, spawns);
            continue;
        };
        match key {
            "planet" | "moon" => continue,
            _ if is_guard(key) => continue,
            "spawn_natural_wormhole" => {
                last = Some(spawns.len());
                spawns.push(Spawn {
                    kind: BypassKind::of_wormhole(scalar(child, "bypass_type", src)),
                    site: here.clone(),
                    far: None,
                });
                continue;
            }
            "spawn_megastructure" => {
                if let Some(kind) =
                    scalar(child, "type", src).and_then(BypassKind::of_megastructure)
                {
                    spawns.push(Spawn {
                        kind,
                        site: here.clone(),
                        far: None,
                    });
                }
                continue;
            }
            "link_wormholes" => {
                if let Some(at) = last {
                    spawns[at].far = Some(linked(child, src, scopes));
                }
                continue;
            }
            _ => {}
        }
        let inner = scopes.descend(key, || opened(key, child, src));
        collect(child, src, &inner, spawns);
    }
}

/// The system a block that opens a scope of its own runs on.
fn opened(key: &str, node: &Node, src: &[u8]) -> InitSite {
    if let Some(token) = key.strip_prefix("event_target:") {
        InitSite::Target(token.to_owned())
    } else if claims::is_system_loop(key) && !names_star_flag(node, src) {
        InitSite::Random
    } else {
        InitSite::Unknown
    }
}

/// What a `link_wormholes` names, in the scope it is written in.
fn linked(node: &Node, src: &[u8], scopes: &Scopes<InitSite>) -> InitSite {
    let value = node.scalar_str(src).unwrap_or_default();
    match value.strip_prefix("event_target:") {
        Some(token) => InitSite::Target(token.to_owned()),
        None if value == "prev" => scopes.outer().clone(),
        None => InitSite::Unknown,
    }
}

/// Whether a scope's guard insists on a star flag, by the same positive
/// conjunct rule the day-one claims are indexed by.
fn names_star_flag(node: &Node, src: &[u8]) -> bool {
    let Some(limit) = node.find("limit", src) else {
        return false;
    };
    let mut found = Vec::new();
    claims::star_flags(&Condition::compile(limit, src), &mut found);
    !found.is_empty()
}

fn scalar<'a>(node: &Node, key: &str, src: &'a [u8]) -> Option<&'a str> {
    node.find(key, src)?.scalar_str(src)
}
