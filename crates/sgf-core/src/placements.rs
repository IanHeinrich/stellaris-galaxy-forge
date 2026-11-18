//! The statements of an effect block that place things in a system: ruined megastructures,
//! ambient objects and modifiers. An initializer's `init_effect` and a scenario system's
//! `effect` are read alike, and every other statement is kept with its span, so a writer can
//! leave it where it is.

use crate::cst::{self, Node};
use crate::projections::geometry::{angle_about, normalised, point};
use crate::span::Span;

pub const SPAWN_MEGASTRUCTURE: &str = "spawn_megastructure";
pub const CREATE_AMBIENT_OBJECT: &str = "create_ambient_object";
pub const ADD_MODIFIER: &str = "add_modifier";
const LAST_CREATED_AMBIENT_OBJECT: &str = "last_created_ambient_object";
const SET_LOCATION: &str = "set_location";

/// The turn from a written angle to the editor's: a spawn's `orbit_angle` or a
/// `set_location` `angle` of 0 stands at 180 degrees as the editor measures `atan2(y, x)` in
/// the save frame.
pub const ORBIT_START: f64 = 180.0;

/// The editor's angle, in [0, 360), of an angle the game reads.
pub fn editor_angle(game: f64) -> f64 {
    normalised(game + ORBIT_START)
}

/// The angle, in [0, 360), the game reads for the editor's `editor`.
pub fn game_angle(editor: f64) -> f64 {
    normalised(editor - ORBIT_START)
}

/// The point in the save frame that `distance` and the game's `angle` about `centre` name.
pub fn point_at(centre: (f64, f64), distance: f64, angle: f64) -> (f64, f64) {
    point(centre, distance, editor_angle(angle))
}

/// The distance and the game's angle about `centre` that name `at`: [`point_at`] undone.
pub fn game_at(centre: (f64, f64), at: (f64, f64)) -> (f64, f64) {
    let distance = (at.0 - centre.0).hypot(at.1 - centre.1);
    (distance, game_angle(angle_about(centre, at)))
}

/// One statement of an effect block. Spans index the source the block was parsed from.
#[derive(Debug, Clone, PartialEq)]
pub enum Statement {
    SpawnMegastructure(SpawnMegastructure),
    AmbientObject(AmbientObject),
    SystemModifier(SystemModifier),
    /// Any other statement, as written.
    Foreign(Span),
}

impl Statement {
    /// The bytes the statement covers: for an ambient object with its point, both statements
    /// and what lies between them.
    pub fn span(&self) -> Span {
        match self {
            Self::SpawnMegastructure(spawn) => spawn.span,
            Self::AmbientObject(object) => match &object.at {
                Some(at) => Span::new(object.span.start, at.span.end),
                None => object.span,
            },
            Self::SystemModifier(modifier) => modifier.span,
            Self::Foreign(span) => *span,
        }
    }
}

/// A `spawn_megastructure` that names its `type`.
#[derive(Debug, Clone, PartialEq)]
pub struct SpawnMegastructure {
    /// `type`, unquoted.
    pub kind: String,
    pub place: SpawnPlace,
    pub span: Span,
}

/// Where a `spawn_megastructure` says it stands.
#[derive(Debug, Clone, PartialEq)]
pub enum SpawnPlace {
    /// `planet = …`: at the body, or a row tied to it holding its own point at `orbit`.
    OnBody {
        target: String,
        orbit: Option<Orbit>,
    },
    /// `coords_from = …` and no `planet`: at that object's point. The game ignores an orbit.
    CoordsFrom {
        target: String,
        orbit: Option<Orbit>,
    },
    /// `random_pos = no`, an orbit and no `planet`: a free point measured from the system's
    /// centre.
    Free(Orbit),
    /// `random_pos = no` with no orbit and no `planet`.
    Centre,
    /// No `planet` and `random_pos` not `no`: a spot the game picks. `stated` when
    /// `random_pos = yes` is written.
    Random { stated: bool, orbit: Option<Orbit> },
}

/// `orbit_distance` and `orbit_angle`, at least one written; an unwritten one reads 0. The
/// angle is the game's.
#[derive(Debug, Clone, PartialEq)]
pub struct Orbit {
    pub distance: Amount,
    pub angle: Amount,
}

/// A value as written.
#[derive(Debug, Clone, PartialEq)]
pub enum Amount {
    Number(f64),
    /// Anything else, such as a `@variable`, inline maths or a `{ min max }` range: its text.
    Written(String),
}

impl Amount {
    pub fn number(&self) -> Option<f64> {
        match self {
            Self::Number(n) => Some(*n),
            Self::Written(_) => None,
        }
    }
}

/// A `create_ambient_object` that names its `type`.
#[derive(Debug, Clone, PartialEq)]
pub struct AmbientObject {
    /// `type`, unquoted.
    pub kind: String,
    /// The statement right after it, with only whitespace between, when it is exactly the
    /// editor's own `set_location`. Without one the object lands where the game picks.
    pub at: Option<AmbientPoint>,
    pub span: Span,
}

/// `last_created_ambient_object = { set_location = { target = prev distance = D angle = A } }`,
/// measured from the system's main star with the game's angle.
#[derive(Debug, Clone, PartialEq)]
pub struct AmbientPoint {
    pub distance: f64,
    pub angle: f64,
    pub span: Span,
}

/// An `add_modifier` that names its `modifier`.
#[derive(Debug, Clone, PartialEq)]
pub struct SystemModifier {
    pub modifier: String,
    pub days: Option<Amount>,
    pub span: Span,
}

/// The statements of `block`, in file order. Only its own statements are read: one under an
/// `if` or a scope is foreign, and so is an ambient object placed anywhere but `this`.
pub fn read(block: &Node, src: &[u8]) -> Vec<Statement> {
    let children = block.children();
    let mut out = Vec::with_capacity(children.len());
    let mut at = 0;
    while let Some(child) = children.get(at) {
        let statement = if let Some(spawn) = spawn_megastructure(child, src) {
            Statement::SpawnMegastructure(spawn)
        } else if let Some(mut object) = ambient_object_here(child, src) {
            object.at = children
                .get(at + 1)
                .filter(|next| blank(src, child.span().end, next.span().start))
                .and_then(|next| ambient_point(next, src));
            at += usize::from(object.at.is_some());
            Statement::AmbientObject(object)
        } else if let Some(modifier) = modifier(child, src) {
            Statement::SystemModifier(modifier)
        } else {
            let span = cst::statement_span(children, at, src);
            at += cst::continuation(children, at, src);
            Statement::Foreign(span)
        };
        at += 1;
        out.push(statement);
    }
    out
}

/// Whether only whitespace lies between `start` and `end`, so a rewrite of both sides
/// deletes no comment.
fn blank(src: &[u8], start: usize, end: usize) -> bool {
    src[start..end].iter().all(u8::is_ascii_whitespace)
}

/// `node` as a `spawn_megastructure` that names its `type`.
pub fn spawn_megastructure(node: &Node, src: &[u8]) -> Option<SpawnMegastructure> {
    if node.key_str(src) != Some(SPAWN_MEGASTRUCTURE) {
        return None;
    }
    let kind = scalar(node, "type", src)?;
    let orbit = orbit(node, src);
    let place = if let Some(target) = scalar(node, "planet", src) {
        SpawnPlace::OnBody {
            target: target.to_owned(),
            orbit,
        }
    } else if let Some(target) = scalar(node, "coords_from", src) {
        SpawnPlace::CoordsFrom {
            target: target.to_owned(),
            orbit,
        }
    } else if scalar(node, "random_pos", src) == Some("no") {
        orbit.map_or(SpawnPlace::Centre, SpawnPlace::Free)
    } else {
        SpawnPlace::Random {
            stated: scalar(node, "random_pos", src) == Some("yes"),
            orbit,
        }
    };
    Some(SpawnMegastructure {
        kind: kind.to_owned(),
        place,
        span: node.span(),
    })
}

/// `node` as a `create_ambient_object` that names its `type`, at whatever `location` it
/// writes and with no point of its own. [`read`] takes only `location = this`.
pub fn ambient_object(node: &Node, src: &[u8]) -> Option<AmbientObject> {
    if node.key_str(src) != Some(CREATE_AMBIENT_OBJECT) {
        return None;
    }
    Some(AmbientObject {
        kind: scalar(node, "type", src)?.to_owned(),
        at: None,
        span: node.span(),
    })
}

/// `node` as an `add_modifier` that names its `modifier`.
pub fn modifier(node: &Node, src: &[u8]) -> Option<SystemModifier> {
    if node.key_str(src) != Some(ADD_MODIFIER) {
        return None;
    }
    Some(SystemModifier {
        modifier: scalar(node, "modifier", src)?.to_owned(),
        days: amount(node, "days", src),
        span: node.span(),
    })
}

/// [`ambient_object`] created in the system's own scope, `location = this`, the only one the
/// editor writes.
fn ambient_object_here(node: &Node, src: &[u8]) -> Option<AmbientObject> {
    ambient_object(node, src).filter(|_| scalar(node, "location", src) == Some("this"))
}

/// `node` as the editor's own `set_location` for the ambient object before it: the one
/// `set_location` with `target = prev` and a number for each of `distance` and `angle`, and
/// nothing else.
fn ambient_point(node: &Node, src: &[u8]) -> Option<AmbientPoint> {
    if node.key_str(src) != Some(LAST_CREATED_AMBIENT_OBJECT) {
        return None;
    }
    let [location] = node.children() else {
        return None;
    };
    if location.key_str(src) != Some(SET_LOCATION) {
        return None;
    }
    let fields = location.children();
    let once = |key| {
        fields
            .iter()
            .filter(|f| f.key_str(src) == Some(key))
            .count()
            == 1
    };
    if fields.len() != 3 || !["target", "distance", "angle"].into_iter().all(once) {
        return None;
    }
    if scalar(location, "target", src) != Some("prev") {
        return None;
    }
    let number = |key| amount(location, key, src)?.number();
    Some(AmbientPoint {
        distance: number("distance")?,
        angle: number("angle")?,
        span: node.span(),
    })
}

fn orbit(node: &Node, src: &[u8]) -> Option<Orbit> {
    let distance = amount(node, "orbit_distance", src);
    let angle = amount(node, "orbit_angle", src);
    if distance.is_none() && angle.is_none() {
        return None;
    }
    let zero = || Amount::Number(0.0);
    Some(Orbit {
        distance: distance.unwrap_or_else(zero),
        angle: angle.unwrap_or_else(zero),
    })
}

/// The first `key` of `node`, with inline maths written with spaces joined back on.
fn amount(node: &Node, key: &str, src: &[u8]) -> Option<Amount> {
    let children = node.children();
    let at = children
        .iter()
        .position(|child| child.key_str(src) == Some(key))?;
    let text = match cst::written(children, at, src) {
        Some(text) => text.into_owned(),
        None => String::from_utf8_lossy(children[at].value_span().slice(src)).into_owned(),
    };
    Some(match text.parse::<f64>() {
        Ok(n) if n.is_finite() => Amount::Number(n),
        _ => Amount::Written(text),
    })
}

fn scalar<'a>(node: &Node, key: &str, src: &'a [u8]) -> Option<&'a str> {
    node.find(key, src)?.scalar_str(src)
}
