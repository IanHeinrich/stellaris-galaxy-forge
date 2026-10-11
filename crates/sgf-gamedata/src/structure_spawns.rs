//! What an initializer's effects write of the megastructures and starbase it places: where
//! each stands, who owns it and whether the game surely places it, as written. Which body a
//! target names and which territory an owner is, the details work out
//! ([`GameData::initializer_details`](crate::GameData::initializer_details)).

use sgf_core::cst::Node;
use sgf_core::format::save::details::SourceLine;

use crate::initializers::{InitStarbase, Origin};
use crate::install::script::{Def, Range};
use crate::scripts::scope::{
    SAVES_TARGET, describes_system, is_call, is_guard, keeps_scope, keeps_system_scope, runs_always,
};

pub(crate) const SPAWN_MEGASTRUCTURE: &str = "spawn_megastructure";
pub(crate) const CREATE_STARBASE: &str = "create_starbase";

/// The turn a spawn whose `orbit_angle` the reader cannot take may be drawn at: anywhere.
const ANY_ANGLE: Range = Range {
    min: 0.0,
    max: 360.0,
};

/// Scopes a `graphical_culture` can name in place of a culture.
const SCOPES: [&str; 5] = ["root", "this", "prev", "from", "owner"];

/// Where a `spawn_megastructure` says it stands, as written.
#[derive(Debug, Clone, PartialEq)]
pub enum WrittenPlace {
    /// No position: the system's centre.
    Centre,
    /// `orbit_distance` and `orbit_angle` about the centre, a missing one 0, and an angle the
    /// reader cannot take anywhere from 0 to 360.
    Orbit { distance: Range, angle: Range },
    /// Where it stands is not known, as written: an `orbit_distance` the reader cannot take
    /// (an unknown `@variable`, a parameter), or the body scope it is spawned from
    /// (`every_system_planet`) when it names no body by an event target or `star`.
    Unknown(String),
    /// `planet = …`, as written: `star`, `event_target:X`, `prev`, `this`.
    Planet(String),
    /// `coords_from = …`, as written.
    CoordsFrom(String),
    /// `random_pos = yes`.
    Random,
}

/// One `spawn_megastructure` that names its `type`.
#[derive(Debug, Clone, PartialEq)]
pub struct InitMegastructure {
    pub kind: String,
    pub place: WrittenPlace,
    /// `owner`, as written.
    pub owner: Option<String>,
    /// `graphical_culture`, when it names a culture rather than a scope or a target.
    pub culture: Option<String>,
    /// Written outside every `if`, `random_list`, loop and other scope.
    pub always: bool,
    pub line: SourceLine,
}

/// A `key = yes` or `key = { … }` in a system's effects that is no block of its scope: a
/// scripted effect's call, when the install defines one by that name.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EffectCall {
    pub key: String,
    /// Written outside every `if`, `random_list`, loop and other scope.
    pub always: bool,
    pub line: SourceLine,
}

/// What a block's effects write in its system: every megastructure, the first
/// `create_starbase` when it states a `size`, and the scripted effects called. A block whose
/// scope leaves the system, such as a neighbour system or a country, is not read. One that
/// scopes to its bodies (`every_system_planet`) is: what it spawns is never certain, and
/// stands at a body only when it names one.
#[derive(Debug, Default)]
pub(crate) struct Written {
    pub megastructures: Vec<InitMegastructure>,
    pub starbase: Option<InitStarbase>,
    pub calls: Vec<EffectCall>,
    /// A `create_starbase` was read, whether or not it states a `size`.
    starbase_read: bool,
}

/// What the effects of `node`, a system's or a body's block, write.
pub(crate) fn read(node: &Node, def: &Def, origin: &Origin) -> Written {
    let mut out = Written::default();
    walk(node, def, origin, Walked::Top, &mut out);
    out
}

/// What a scripted effect's own statements write. The effects it calls are not read.
pub(crate) fn read_effect(def: &Def) -> Written {
    let mut out = Written::default();
    let origin = Origin::of(def);
    walk(
        &def.node,
        def,
        &origin,
        Walked::Inside {
            always: true,
            body_scope: None,
        },
        &mut out,
    );
    out
}

/// Where a walk is: in a system's or body's block, whose keys are not effects, or in an
/// effect block, run whenever the block is reached or not, and under a scope of the system's
/// bodies or not.
#[derive(Debug, Clone, Copy, PartialEq)]
enum Walked<'k> {
    Top,
    Inside {
        always: bool,
        /// The body scope it is under, such as `every_system_planet`.
        body_scope: Option<&'k str>,
    },
}

fn walk(node: &Node, def: &Def, origin: &Origin, walked: Walked, out: &mut Written) {
    let src = &def.src;
    let (always, body_scope) = match walked {
        Walked::Top => (true, None),
        Walked::Inside { always, body_scope } => (always, body_scope),
    };
    for child in node.children() {
        let Some(key) = child.key_str(src) else {
            continue;
        };
        match key {
            "planet" | "moon" => {}
            _ if is_guard(key) => {}
            SPAWN_MEGASTRUCTURE => out
                .megastructures
                .extend(megastructure(child, def, origin, always, body_scope)),
            CREATE_STARBASE => {
                if !out.starbase_read && body_scope.is_none() {
                    out.starbase_read = true;
                    out.starbase = starbase(child, src, origin, always);
                }
            }
            _ if describes_system(key) && child.scalar_span().is_none() => {
                let inside = Walked::Inside {
                    always: always && runs_always(key),
                    body_scope: body_scope.or((!keeps_system_scope(key)).then_some(key)),
                };
                walk(child, def, origin, inside, out);
            }
            _ if walked != Walked::Top && is_call(child, src) => {
                out.calls.push(EffectCall {
                    key: key.to_owned(),
                    always,
                    line: origin.at(child.span().start),
                });
            }
            _ => {}
        }
    }
}

/// The `spawn_megastructure` `node`, written under `body_scope` when it is.
fn megastructure(
    node: &Node,
    def: &Def,
    origin: &Origin,
    always: bool,
    body_scope: Option<&str>,
) -> Option<InitMegastructure> {
    let src = &def.src;
    let kind = scalar(node, "type", src)?;
    let written = |key| scalar(node, key, src).map(str::to_owned);
    let place = if let Some(target) = written("planet") {
        WrittenPlace::Planet(target)
    } else if let Some(target) = written("coords_from") {
        WrittenPlace::CoordsFrom(target)
    } else if scalar(node, "random_pos", src) == Some("yes") {
        WrittenPlace::Random
    } else {
        orbit(node, def)
    };
    let place = match (body_scope, place) {
        (None, place) => place,
        (Some(_), WrittenPlace::Planet(target)) if names_a_body(&target) => {
            WrittenPlace::Planet(target)
        }
        (Some(_), WrittenPlace::CoordsFrom(target)) if names_a_body(&target) => {
            WrittenPlace::CoordsFrom(target)
        }
        (Some(scope), _) => WrittenPlace::Unknown(scope.to_owned()),
    };
    Some(InitMegastructure {
        kind: kind.to_owned(),
        place,
        owner: written("owner"),
        culture: written("graphical_culture")
            .filter(|c| !c.contains(':') && !SCOPES.contains(&c.as_str())),
        always,
        line: origin.at(node.span().start),
    })
}

/// A target that names the same body whichever scope it is written in.
fn names_a_body(target: &str) -> bool {
    target == "star" || target.starts_with("event_target:")
}

/// Where a spawn written with no target stands: the centre, or about it.
fn orbit(node: &Node, def: &Def) -> WrittenPlace {
    let src = &def.src;
    let distance = node.find("orbit_distance", src);
    let angle = node.find("orbit_angle", src);
    if distance.is_none() && angle.is_none() {
        return WrittenPlace::Centre;
    }
    let distance = match distance {
        None => Range::fixed(0.0),
        Some(written) => match def.initializer_range_of(written) {
            Some(range) => range,
            None => {
                return WrittenPlace::Unknown(
                    String::from_utf8_lossy(written.span().slice(src)).into_owned(),
                );
            }
        },
    };
    WrittenPlace::Orbit {
        distance,
        angle: angle.map_or(Range::fixed(0.0), |written| {
            def.initializer_range_of(written).unwrap_or(ANY_ANGLE)
        }),
    }
}

fn starbase(node: &Node, src: &[u8], origin: &Origin, always: bool) -> Option<InitStarbase> {
    Some(InitStarbase {
        size: scalar(node, "size", src)?.to_owned(),
        modules: values(node, "module", src),
        buildings: values(node, "building", src),
        owner: scalar(node, "owner", src).map(str::to_owned),
        always,
        line: origin.at(node.span().start),
    })
}

/// Every event target a body's block saves on the body: its `save_event_target_as` and
/// `save_global_event_target_as`, through the blocks that keep its scope.
pub(crate) fn saved_targets(node: &Node, src: &[u8]) -> Vec<String> {
    let mut out = Vec::new();
    collect_targets(node, src, &mut out);
    out
}

fn collect_targets(node: &Node, src: &[u8], out: &mut Vec<String>) {
    for child in node.children() {
        match child.key_str(src) {
            Some(key) if SAVES_TARGET.contains(&key) => {
                out.extend(child.scalar_str(src).map(str::to_owned));
            }
            Some(key) if keeps_scope(key) && !is_guard(key) => collect_targets(child, src, out),
            _ => {}
        }
    }
}

fn values(node: &Node, key: &str, src: &[u8]) -> Vec<String> {
    node.find_all(key, src)
        .filter_map(|n| n.scalar_str(src))
        .map(str::to_owned)
        .collect()
}

fn scalar<'a>(node: &Node, key: &str, src: &'a [u8]) -> Option<&'a str> {
    node.find(key, src)?.scalar_str(src)
}
