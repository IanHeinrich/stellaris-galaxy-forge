//! The megastructures and starbase a scenario system's initializer places, in the shape a
//! save's rows have: the body each is tied to, where it stands and who owns it.

use sgf_core::emit;
use sgf_core::format::save::details::{
    Bounds, MegastructureSummary, PlanetSummary, SpawnPlace, StarbaseSummary, StructureSpawn,
};
use sgf_core::ops::rules::RELAY_RADIUS_FACTOR;
use sgf_core::projections::geometry::point;
use sgf_core::projections::name::NameTemplate;

use crate::GameData;
use crate::details::{MEGASTRUCTURE_BASE, STARBASE_BASE, bounds, index};
use crate::initializers::{self, Body, BodyClass, InitStarbase, Initializer};
use crate::install::script::Def;
use crate::layouts::{StarSource, star_source};
use crate::registries::megastructures::{MegastructureTypes, RELAY_BYPASS};
use crate::scripts::ScenarioOwners;
use crate::structure_spawns::{
    self, CREATE_STARBASE, EffectCall, InitMegastructure, SPAWN_MEGASTRUCTURE, Written,
    WrittenPlace,
};

/// The angle a written `orbit_angle` turns on from, as a body's first angle does.
const ORBIT_START: f64 = 180.0;

/// Where a gateway placed at random typically stands, as a share of its system's inner radius:
/// the middle of the 1.18 to 1.30 the sample saves show.
const GATEWAY_RADIUS_FACTOR: f64 = 1.24;

/// The angle the first structure placed at random is drawn at, across the star from the main
/// starbase; each one after it turns on by [`RANDOM_STEP`].
const RANDOM_ANGLE: f64 = 135.0;
const RANDOM_STEP: f64 = 90.0;

/// The main starbase stands at (a, −a), a = [`STARBASE_BASE_OFFSET`] + [`STARBASE_SIZE_SHARE`]
/// × the star's size.
const STARBASE_BASE_OFFSET: f64 = 11.7;
const STARBASE_SIZE_SHARE: f64 = 0.33;

/// What a scenario system's initializer places beside its bodies.
#[derive(Debug, Default)]
pub(crate) struct Structures {
    pub megastructures: Vec<MegastructureSummary>,
    pub starbase: Option<StarbaseSummary>,
    /// Each megastructure that stands at a body: its id, and the body's index in the planets
    /// it was resolved against.
    pub anchored: Vec<(u32, usize)>,
    /// The scripted effect calls read whole: every statement of the effect gave a row or the
    /// starbase.
    pub modelled_calls: Vec<EffectCall>,
}

/// Where a megastructure stands.
struct Placement {
    /// The body it stands at, by its index in the system's planets.
    anchor: Option<usize>,
    /// The body it is tied to, by id.
    planet: Option<u32>,
    at: Option<(f64, f64)>,
    place: SpawnPlace,
}

/// What one system's structures are resolved against.
struct Context<'a> {
    id: u32,
    planets: &'a [PlanetSummary],
    bodies: Vec<Body<'a>>,
    /// Each body's point about the centre, in the order of `bodies`.
    points: &'a [(f64, f64)],
    inner_radius: f64,
    owners: Option<&'a ScenarioOwners>,
    megastructures: &'a MegastructureTypes,
    /// How many structures placed at random have been given a spot.
    random: u32,
}

/// A scripted effect a system calls with no parameters, and what it writes.
struct Called<'i, 'g> {
    call: &'i EffectCall,
    def: &'g Def,
    written: Written,
}

impl GameData {
    /// The megastructures and starbase `init` places in system `id`, whose bodies are
    /// `planets`, standing at `points`, and whose inner radius the game draws from
    /// `inner_radius`. `owners` names the territory each written owner is, and the one the
    /// system joins.
    pub(crate) fn structures(
        &self,
        id: u32,
        init: &Initializer,
        planets: &[PlanetSummary],
        points: &[(f64, f64)],
        inner_radius: Option<Bounds>,
        owners: Option<&ScenarioOwners>,
    ) -> Structures {
        let mut cx = Context {
            id,
            planets,
            bodies: initializers::expand(&init.planets).collect(),
            points,
            inner_radius: inner_radius.map_or_else(
                || self.system_radii.inner_about(0.0),
                |b| (b.min + b.max) / 2.0,
            ),
            owners,
            megastructures: &self.megastructures,
            random: 0,
        };
        let called: Vec<Called> = init
            .calls
            .iter()
            .filter_map(|call| {
                let def = self.scripts.effect(&call.key)?;
                let parameterless = !def.node.span().slice(&def.src).contains(&b'$');
                parameterless.then(|| Called {
                    call,
                    def,
                    written: structure_spawns::read_effect(def),
                })
            })
            .collect();

        let mut spawns: Vec<(&InitMegastructure, Option<usize>, bool)> = init
            .megastructures
            .iter()
            .map(|spawn| (spawn, None, true))
            .collect();
        for c in &called {
            spawns.extend(
                c.written
                    .megastructures
                    .iter()
                    .map(|s| (s, None, c.call.always)),
            );
        }
        let bodies = cx.bodies.clone();
        for (i, body) in bodies.iter().enumerate() {
            spawns.extend(
                body.block
                    .megastructures
                    .iter()
                    .map(|s| (s, Some(i), body.always)),
            );
        }
        let mut out = Structures::default();
        for (n, (spawn, from, always)) in spawns.into_iter().enumerate() {
            let (row, anchor) = cx.megastructure(n, spawn, from, always);
            out.anchored.extend(anchor.map(|i| (row.id, i)));
            out.megastructures.push(row);
        }

        let from_call = init
            .starbase
            .is_none()
            .then(|| called.iter().find(|c| c.written.starbase.is_some()))
            .flatten();
        let starbase = match from_call {
            Some(c) => c.written.starbase.as_ref().map(|s| (s, c.call.always)),
            None => init.starbase.as_ref().map(|s| (s, true)),
        };
        let star_size = self.star_size(init, &cx);
        out.starbase = starbase.map(|(s, always)| {
            let level = self.starbase_level(&s.size);
            cx.starbase(s, level, always, star_size)
        });
        out.modelled_calls = called
            .iter()
            .filter(|c| whole(c, from_call.is_some_and(|f| std::ptr::eq(f, *c))))
            .map(|c| c.call.clone())
            .collect();
        out
    }

    /// The starbase level whose ship size is `size`, as a save names a station's level; `size`
    /// as written when no level has that ship size.
    fn starbase_level(&self, size: &str) -> String {
        self.starbase_levels
            .iter()
            .find(|level| level.ship_size.as_deref() == Some(size))
            .map_or_else(|| size.to_owned(), |level| level.key.clone())
    }

    /// The size range of the system's first star: its block's own `size`, else for a block
    /// written `class = star` every size the star classes the system can draw give their
    /// first star, else its class's.
    fn star_size(&self, init: &Initializer, cx: &Context) -> Option<Bounds> {
        let i = cx.star()?;
        let block = cx.bodies[i].block;
        let drawn = || {
            let classes: Vec<&str> = match star_source(self, init) {
                StarSource::Fixed(class) => vec![class.key.as_str()],
                StarSource::List(list) => list.stars.iter().map(String::as_str).collect(),
                StarSource::Unknown => Vec::new(),
            };
            classes
                .into_iter()
                .filter_map(|key| self.star_classes.get(key)?.planet_keys().next())
                .filter_map(|key| self.planet_classes.get(key)?.planet_size)
                .map(bounds)
                .reduce(|a, b| Bounds {
                    min: a.min.min(b.min),
                    max: a.max.max(b.max),
                })
        };
        let own = block.size_range().map(bounds);
        let from_stars = (own.is_none() && block.class == BodyClass::Star)
            .then(drawn)
            .flatten();
        own.or(from_stars)
            .or_else(|| cx.planets[i].layout.as_ref()?.size)
    }
}

/// Whether every statement of the effect `c` calls gave a row, or the starbase when `starbase`
/// says its starbase became the system's.
fn whole(c: &Called, starbase: bool) -> bool {
    let src = &c.def.src;
    let gave_rows = !c.written.megastructures.is_empty() || starbase;
    gave_rows
        && c.def
            .node
            .children()
            .iter()
            .all(|child| match child.key_str(src) {
                Some(SPAWN_MEGASTRUCTURE) => child
                    .find("type", src)
                    .and_then(|t| t.scalar_str(src))
                    .is_some(),
                Some(CREATE_STARBASE) => starbase,
                _ => false,
            })
}

impl Context<'_> {
    /// The row of `spawn`, the `n`th of the system, written in body `from`'s block when it
    /// has one, and the body it stands at.
    fn megastructure(
        &mut self,
        n: usize,
        spawn: &InitMegastructure,
        from: Option<usize>,
        always: bool,
    ) -> (MegastructureSummary, Option<usize>) {
        let placed = self.place(spawn, from);
        let (owner, owner_written) = self.owner(spawn.owner.as_deref());
        let body_always = placed.anchor.is_none_or(|i| self.bodies[i].always);
        let row = MegastructureSummary {
            id: MEGASTRUCTURE_BASE + index(n),
            kind: spawn.kind.clone(),
            owner,
            planet: placed.planet,
            at: placed.at,
            culture: spawn.culture.clone(),
            made_body: false,
            spawn: Some(StructureSpawn {
                at: Some(spawn.line.clone()),
                always: always && spawn.always && body_always,
                place: placed.place,
                owner_written,
            }),
        };
        (row, placed.anchor)
    }

    /// Where `spawn` stands; `from` is the body whose block it is written in.
    fn place(&mut self, spawn: &InitMegastructure, from: Option<usize>) -> Placement {
        let free = |at, place| Placement {
            anchor: None,
            planet: None,
            at,
            place,
        };
        let unknown = |written: &str| {
            let place = SpawnPlace::Unknown {
                written: written.to_owned(),
            };
            free(None, place)
        };
        match &spawn.place {
            WrittenPlace::Centre => free(Some((0.0, 0.0)), SpawnPlace::Centre),
            WrittenPlace::Orbit { distance, angle } => free(
                Some(rounded(point(
                    (0.0, 0.0),
                    distance.midpoint(),
                    angle.midpoint() + ORBIT_START,
                ))),
                SpawnPlace::Orbit {
                    distance: bounds(*distance),
                    angle: bounds(*angle),
                },
            ),
            WrittenPlace::Unknown(written) => unknown(written),
            WrittenPlace::Planet(target) => match self.body(target, from) {
                Some(i) => {
                    let body = self.planets[i].id;
                    Placement {
                        anchor: Some(i),
                        planet: Some(body),
                        at: Some(self.points[i]),
                        place: SpawnPlace::Body { body },
                    }
                }
                None => unknown(target),
            },
            WrittenPlace::CoordsFrom(target) => match self.body(target, from) {
                Some(i) => Placement {
                    anchor: Some(i),
                    planet: None,
                    at: Some(self.points[i]),
                    place: SpawnPlace::NearBody {
                        body: self.planets[i].id,
                    },
                },
                None => unknown(target),
            },
            WrittenPlace::Random => free(Some(self.random_spot(&spawn.kind)), SpawnPlace::Random),
        }
    }

    /// The body `target` names: the system's star, the body whose block the statement is
    /// written in for `prev` (inside `solar_system = { … }`, where `this` is the system), or
    /// the last body whose block saves the event target, its own block first.
    fn body(&self, target: &str, from: Option<usize>) -> Option<usize> {
        match target {
            "star" => self.star(),
            "prev" => from,
            _ => {
                let token = target.strip_prefix("event_target:")?;
                let saves = |i: &usize| {
                    self.bodies[*i]
                        .block
                        .saves_target
                        .iter()
                        .any(|t| t == token)
                };
                from.filter(saves)
                    .or_else(|| (0..self.bodies.len()).rev().find(saves))
            }
        }
    }

    /// The system's first star body: written `class = star`, or of a class the install makes
    /// a star.
    fn star(&self) -> Option<usize> {
        (0..self.planets.len()).find(|&i| {
            self.bodies[i].block.class == BodyClass::Star || self.planets[i].star_class.is_some()
        })
    }

    /// A typical spot for a structure the game places at random: a relay on its ring, anything
    /// else outside the planets as the game's gateways are.
    fn random_spot(&mut self, kind: &str) -> (f64, f64) {
        let factor = match self.relay(kind) {
            true => RELAY_RADIUS_FACTOR,
            false => GATEWAY_RADIUS_FACTOR,
        };
        let angle = RANDOM_ANGLE + RANDOM_STEP * f64::from(self.random);
        self.random += 1;
        rounded(point((0.0, 0.0), self.inner_radius * factor, angle))
    }

    /// Whether type `kind` stands for a relay: its `bypass_type` says so, or, for a variant
    /// that names none, as a ruined relay does, its working type's.
    fn relay(&self, kind: &str) -> bool {
        let types = self.megastructures;
        let Some(def) = types.get(kind) else {
            return false;
        };
        let bypass = def.bypass_type.as_deref().or_else(|| {
            let working = types.get(def.variant_of.as_deref()?)?;
            working.bypass_type.as_deref()
        });
        bypass == Some(RELAY_BYPASS)
    }

    /// The territory an owner `written` as such names, and the owner as written when it names
    /// none. With none written, the territory the system joins.
    fn owner(&self, written: Option<&str>) -> (Option<u32>, Option<String>) {
        let Some(written) = written else {
            let here = self
                .owners
                .and_then(|o| o.owners.iter().find(|s| s.system == self.id))
                .map(|s| s.territory);
            return (here, None);
        };
        let territory = written
            .strip_prefix("event_target:")
            .and_then(|token| self.owners?.territory_of(token));
        (territory, territory.is_none().then(|| written.to_owned()))
    }

    /// The starbase `s` creates, at `level`.
    fn starbase(
        &self,
        s: &InitStarbase,
        level: String,
        always: bool,
        star_size: Option<Bounds>,
    ) -> StarbaseSummary {
        let (at, place) = match star_size {
            Some(size) => (
                Some(starbase_point((size.min + size.max) / 2.0)),
                SpawnPlace::Starbase { star_size: size },
            ),
            None => (
                None,
                SpawnPlace::Unknown {
                    written: "star".to_owned(),
                },
            ),
        };
        let (owner, owner_written) = self.owner(s.owner.as_deref());
        StarbaseSummary {
            id: STARBASE_BASE.saturating_add(self.id).min(u32::MAX - 1),
            hull: 0.0,
            max_hull: 0.0,
            level,
            kind: String::new(),
            name: NameTemplate::default(),
            name_key: String::new(),
            owner,
            modules: s.modules.clone(),
            buildings: s.buildings.clone(),
            shipyard: s.modules.iter().any(|m| m == "shipyard"),
            at,
            planet: None,
            culture: None,
            spawn: Some(StructureSpawn {
                at: Some(s.line.clone()),
                always: always && s.always,
                place,
                owner_written,
            }),
        }
    }
}

/// Where the game puts a system's main starbase beside a star of `size`.
fn starbase_point(size: f64) -> (f64, f64) {
    let a = STARBASE_BASE_OFFSET + STARBASE_SIZE_SHARE * size;
    rounded((a, -a))
}

/// `at` to the 5 decimals the game writes, with no negative zero.
fn rounded((x, y): (f64, f64)) -> (f64, f64) {
    (emit::rounded(x) + 0.0, emit::rounded(y) + 0.0)
}
