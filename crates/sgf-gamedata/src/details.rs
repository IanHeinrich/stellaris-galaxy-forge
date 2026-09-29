//! What a scenario system shows in place of the save's details projection: everything its
//! initializer statically defines, in the [`SystemDetails`] shape a save answers with.
//!
//! Effects a scripted effect hides (`spawn_dreadnought = yes`) are not resolved, so a
//! system shows what its initializer file writes out and nothing more.

use std::convert::Infallible;

use sgf_core::format::save::details::{
    ArchaeologySite, BodyLayout, Bounds, DepositCount, DetailsResolver, FleetPresence,
    MegastructureSummary, PlanetSummary, ResourceAmount, StarbaseSummary, SystemDetails,
};
use sgf_core::projections::name::NameTemplate;

use crate::GameData;
use crate::generate::{belt, generate};
use crate::initializers::{self, Body, BodyClass, InitPlanet, Initializer, body_size};
use crate::install::script::Range;
use crate::layouts::star_body;
use crate::orbit_walk::{self, Placed, Walk, draw};
use crate::registries::planet_classes::PlanetClassDef;
use crate::registries::star_classes::StarClass;
use crate::rng::Rng;
use crate::scripts::ScenarioOwners;
use crate::views::{PlaceholderBody, RolledBody, SystemRoll};

/// Bodies an initializer gives no id: each collection counts from a base far above any id
/// a save or a scenario writes, so a synthetic id never collides with a real one.
const PLANET_BASE: u32 = 0x4000_0000;
const MEGASTRUCTURE_BASE: u32 = 0x5000_0000;
/// A scenario starbase's synthetic id: one per system, never a real entity.
const STARBASE_BASE: u32 = 0x7000_0000;
const SITE_BASE: u32 = 0x6000_0000;

/// The planets and moons one initializer spawns, with the dig sites they carry.
#[derive(Debug, Default)]
struct Bodies {
    planets: Vec<PlanetSummary>,
    sites: Vec<ArchaeologySite>,
}

impl GameData {
    /// System `id`'s details as the initializer `key` defines them, every list empty when it
    /// places nothing; `None` when the install does not define it, as for `random` or none.
    ///
    /// `owners` names the bodies the scripts colonise and the territory each joins, which
    /// only a pass over every system can tell.
    pub fn initializer_details(
        &self,
        id: u32,
        key: &str,
        owners: Option<&ScenarioOwners>,
    ) -> Option<SystemDetails> {
        let init = self.initializers.get(key)?;
        let Bodies {
            mut planets,
            mut sites,
        } = self.bodies(init);
        for colony in owners.iter().flat_map(|o| &o.colonies) {
            if colony.system != id {
                continue;
            }
            if let Some(planet) = usize::try_from(colony.planet_index)
                .ok()
                .and_then(|i| planets.get_mut(i))
            {
                planet.colonised = true;
                planet.owner = Some(colony.territory);
            }
        }
        // A site the system's own effects dig: which body it lands on is a guess, and one
        // with no body to sit on is dropped.
        if let Some(first) = planets.first().map(|p| p.id) {
            for kind in &init.sites {
                sites.push(ArchaeologySite {
                    id: SITE_BASE + index(sites.len()),
                    kind: kind.clone(),
                    planet: first,
                });
            }
        }
        let megastructures: Vec<MegastructureSummary> = init
            .megastructures
            .iter()
            .enumerate()
            .map(|(i, kind)| MegastructureSummary {
                id: MEGASTRUCTURE_BASE + index(i),
                kind: kind.clone(),
                owner: None,
                planet: None,
            })
            .collect();
        let starbase = init.starbase.as_ref().map(|s| StarbaseSummary {
            id: STARBASE_BASE.saturating_add(id).min(u32::MAX - 1),
            hull: 0.0,
            max_hull: 0.0,
            level: s.size.clone(),
            kind: String::new(),
            name: NameTemplate::default(),
            name_key: String::new(),
            owner: None,
            modules: s.modules.clone(),
            buildings: s.buildings.clone(),
            shipyard: s.modules.iter().any(|m| m == "shipyard"),
        });
        let resources = system_resources(&planets);
        Some(SystemDetails {
            id,
            resources,
            planets,
            starbase,
            fleets: FleetPresence::default(),
            fleets_present: Vec::new(),
            megastructures,
            sites,
            with_game_data: true,
            belts: init.asteroid_belts.iter().filter_map(belt).collect(),
            inner_radius: None,
        })
    }

    /// The star class a scenario system with `initializer` is drawn as: the initializer's
    /// own class, else [`RANDOM_STAR_CLASS`] when it draws from a random list, names none or
    /// is not in the install, since the game picks that star only when it generates the
    /// galaxy.
    pub fn scenario_star_class(&self, initializer: &str) -> &str {
        star_class_of(self.initializers.get(initializer))
    }

    /// Each body's planet class, in source order, in a system of star class `system`. A body
    /// written as the bare `star`, or as a star class, takes that class's planet key for the
    /// nth such body, as the game spawns a binary's two stars, and its first once they run
    /// out. Any other body, and a star whose class the install does not define, keeps the
    /// class it is written as.
    pub fn star_body_classes<'a>(
        &self,
        system: &str,
        written: impl IntoIterator<Item = &'a str>,
    ) -> Vec<String> {
        let mut nth = 0;
        written
            .into_iter()
            .map(|class| {
                let star = if BodyClass::of(class) == BodyClass::Star {
                    system
                } else if self.star_classes.get(class).is_some()
                    && self.planet_classes.get(class).is_none()
                {
                    class
                } else {
                    return class.to_owned();
                };
                let star = self.star_classes.get(star);
                let key = star
                    .and_then(|c| c.planet_keys().nth(nth))
                    .or_else(|| star.and_then(|c| c.planet_keys().next()));
                nth += 1;
                key.unwrap_or(class).to_owned()
            })
            .collect()
    }

    /// Save system details with what the install says of each body: the star class each star
    /// is drawn as, in a system of star class `system`, and which bodies orbit a planet.
    pub fn resolve_save_bodies(&self, details: &mut SystemDetails, system: &str) {
        let stars: Vec<(u32, bool)> = details
            .planets
            .iter()
            .map(|p| (p.id, self.is_star_body(&p.class)))
            .collect();
        for planet in &mut details.planets {
            planet.star_class = self.drawn_star_class(&planet.class, system);
            planet.moon = planet
                .parent
                .is_some_and(|parent| !stars.iter().any(|&(id, star)| id == parent && star));
        }
    }

    /// One example roll, `roll`, of scenario system `id` of `initializer`: where each body
    /// its details list lands, the same for the same system and roll. When the game rolls the
    /// system's planets, placeholder planets the generator rolls for star class `star_class`
    /// (or [`RANDOM_STAR_CLASS`] without one), their orbits drawn in to fit inside `within`.
    pub fn system_roll(
        &self,
        id: u32,
        initializer: &str,
        star_class: &str,
        roll: u32,
        within: f64,
    ) -> SystemRoll {
        let seed = roll_seed(id, roll);
        if self.rolls_planets(initializer) {
            let star_class = match star_class {
                "" => RANDOM_STAR_CLASS,
                class => class,
            };
            return SystemRoll {
                rolls_planets: true,
                placeholders: self.placeholders(seed, star_class, within),
                ..SystemRoll::none(id, roll)
            };
        }
        let planets = self
            .initializers
            .get(initializer)
            .map_or(&[][..], |init| init.planets.as_slice());
        let mut example = Example {
            rng: Rng::new(seed),
            bodies: Vec::new(),
        };
        let Ok(()) = orbit_walk::walk(planets, &mut example);
        SystemRoll {
            bodies: example.bodies,
            ..SystemRoll::none(id, roll)
        }
    }

    /// Whether the game places planets the details of a scenario system with `initializer`
    /// cannot list: it is `random`, empty or not defined by the install, or it places its
    /// bodies only through an `inline_script`, which the details do not expand.
    pub fn rolls_planets(&self, initializer: &str) -> bool {
        self.initializers
            .get(initializer)
            .is_none_or(|init| init.inline_script && init.planets.is_empty())
    }

    /// The planets [`generate`] rolls for `star_class`, or for any class when none of the
    /// install's layouts makes it, drawn in about the centre until the outermost lies
    /// [`PLACEHOLDER_MARGIN`] inside `within`.
    fn placeholders(&self, seed: u64, star_class: &str, within: f64) -> Vec<PlaceholderBody> {
        let roll = |class| generate(self, seed, "", (0.0, 0.0), class, 1.0);
        let Ok(spec) = roll(Some(star_class)).or_else(|_| roll(None)) else {
            return Vec::new();
        };
        let outermost = spec.planets.iter().map(|p| p.orbit).fold(0.0, f64::max);
        let fit = match outermost > 0.0 {
            true => ((within - PLACEHOLDER_MARGIN) / outermost).clamp(0.0, 1.0),
            false => 1.0,
        };
        spec.planets
            .iter()
            .map(|p| PlaceholderBody {
                class: p.class.clone(),
                size: p.size,
                orbit: p.orbit * fit,
                angle: p.angle.rem_euclid(360.0),
            })
            .collect()
    }

    fn bodies(&self, init: &Initializer) -> Bodies {
        let mut out = Bodies::default();
        let system = star_class_of(Some(init));
        let expanded: Vec<Body<'_>> = initializers::expand(&init.planets).collect();
        let classes =
            self.star_body_classes(system, expanded.iter().map(|b| b.block.class.written()));
        let moons: Vec<bool> = expanded
            .iter()
            .map(|b| b.parent.is_some_and(|i| !self.is_star_body(&classes[i])))
            .collect();
        let layouts = Layouts::of(&init.planets);
        let bodies = expanded.into_iter().zip(layouts).zip(classes).zip(moons);
        for (((body, layout), class), moon) in bodies {
            let id = planet_id(out.planets.len());
            out.planets
                .push(self.summary(body, class, id, layout, moon, system));
            for kind in &body.block.sites {
                out.sites.push(ArchaeologySite {
                    id: SITE_BASE + index(out.sites.len()),
                    kind: kind.clone(),
                    planet: id,
                });
            }
        }
        out
    }

    /// `class` is the body's planet class, a star's resolved by [`Self::star_body_classes`];
    /// `moon` whether it orbits a planet, as the body is shown; its size and ring follow the
    /// block it is written in, as the generator draws them. `system` is the system's star class.
    fn summary(
        &self,
        expanded: Body<'_>,
        class: String,
        id: u32,
        mut layout: BodyLayout,
        moon: bool,
        system: &str,
    ) -> PlanetSummary {
        let body = expanded.block;
        layout.size = body_size(body, self.planet_classes.get(&class), expanded.moon).map(bounds);
        let name_key = body.name.clone().unwrap_or_default();
        let habitable = self.planet_habitable(&class);
        PlanetSummary {
            id,
            name: if name_key.is_empty() {
                NameTemplate::default()
            } else {
                NameTemplate::plain(&name_key)
            },
            name_key,
            colonised: body.colonised,
            // A pre-FTL world the empire starts beside is never that empire's capital.
            capital: body.home_planet && !body.pre_ftl,
            habitable,
            owner: None,
            moon,
            pre_ftl: body.pre_ftl,
            size: layout.size.map(|size| size.min.round() as u32),
            orbit: None,
            deposits: self.deposit_rows(&body.deposits),
            deposit_keys: deposit_counts(&body.deposits),
            pops: 0,
            parent: expanded.parent.map(planet_id),
            layout: Some(layout),
            ring: self.ring(body, expanded.moon),
            star_class: self.drawn_star_class(&class, system),
            drawn: Some(self.drawn(&class)),
            permanent_modifiers: None,
            anomaly: None,
            class,
        }
    }

    /// A star's body: the bare `star`, or a planet class the install makes a star.
    fn is_star_body(&self, class: &str) -> bool {
        star_body(self, &BodyClass::of(class))
    }

    /// The star class a star body of `class` is drawn as, in a system of star class
    /// `system`: the class whose only star it is, preferring one a new galaxy rolls, else the
    /// system's.
    fn drawn_star_class(&self, class: &str, system: &str) -> Option<String> {
        if !self.is_star_body(class) {
            return None;
        }
        let mut single: Option<&StarClass> = None;
        for star in self
            .star_classes
            .iter()
            .filter(|s| s.planet_keys().eq([class]))
        {
            if single.is_none_or(|held| held.spawn_odds == 0.0 && star.spawn_odds > 0.0) {
                single = Some(star);
            }
        }
        match single {
            Some(star) => Some(star.key.clone()),
            None => (!system.is_empty()).then(|| system.to_owned()),
        }
    }

    /// Whether the game draws a body written as `class`, as [`PlanetSummary::drawn`] says.
    fn drawn(&self, class: &str) -> bool {
        match BodyClass::of(class) {
            BodyClass::Star => false,
            BodyClass::Random(_) => true,
            BodyClass::Named(key) => {
                self.planet_classes.get(&key).is_none() && self.star_classes.get(&key).is_none()
            }
        }
    }

    /// As the generator decides it: a moon and the star never have a ring, a written
    /// `has_ring` wins, and otherwise the body is left to a draw (`None`) only when its class,
    /// or one its list or draw could give, has a `chance_of_ring`.
    fn ring(&self, body: &InitPlanet, moon: bool) -> Option<bool> {
        if moon || body.class == BodyClass::Star {
            return Some(false);
        }
        match body.has_ring {
            Some(stated) => Some(stated),
            None if self.could_ring(&body.class) => None,
            None => Some(false),
        }
    }

    fn could_ring(&self, class: &BodyClass) -> bool {
        let rolls = |c: &PlanetClassDef| !c.star && c.chance_of_ring > 0.0;
        match class {
            BodyClass::Star => false,
            BodyClass::Random(colonizable) => self.planet_classes.drawable(*colonizable).any(rolls),
            BodyClass::Named(key) => match self.planet_lists.get(key) {
                Some(list) => list
                    .iter()
                    .filter_map(|k| self.planet_classes.get(k))
                    .any(rolls),
                None => self.planet_classes.get(key).is_some_and(rolls),
            },
        }
    }

    fn deposit_rows(&self, keys: &[String]) -> Vec<ResourceAmount> {
        let mut rows = Vec::new();
        for produced in keys.iter().filter_map(|k| self.deposit_produces(k)) {
            for (resource, amount) in produced {
                add(&mut rows, &resource, amount);
            }
        }
        rows
    }
}

/// Each body's layout in the order [`initializers::expand`] gives the bodies, each range
/// kept as the bounds a draw could give.
struct Layouts {
    bodies: Vec<BodyLayout>,
    /// The id of the body last placed at this level, which the next one turns from.
    previous: Option<u32>,
}

impl Layouts {
    fn of(planets: &[InitPlanet]) -> Vec<BodyLayout> {
        let mut layouts = Self {
            bodies: Vec::new(),
            previous: None,
        };
        let Ok(()) = orbit_walk::walk(planets, &mut layouts);
        layouts.bodies
    }
}

impl<'p> Walk<'p> for Layouts {
    type Number = Bounds;
    type Error = Infallible;

    /// The same count [`initializers::expand`] gives, so each layout meets its body.
    fn count(&mut self, block: &'p InitPlanet) -> u32 {
        block.instances()
    }

    fn distance(&mut self, distance: Range) -> Bounds {
        bounds(distance)
    }

    fn angle(&mut self, angle: Range) -> Bounds {
        bounds(angle)
    }

    /// A body with no angle may be anywhere on its orbit.
    fn body(&mut self, block: &'p InitPlanet, placed: Placed<Bounds>) -> Result<(), Infallible> {
        let id = planet_id(self.bodies.len());
        let turns_from = self.previous.replace(id);
        self.bodies.push(BodyLayout {
            orbit: Some(placed.orbit),
            at: None,
            size: None,
            orbit_step: Some(placed.step),
            angle_step: block.orbit_angle.map(bounds),
            turns_from,
        });
        let before = self.previous.take();
        let moons = orbit_walk::walk(&block.moons, self);
        self.previous = before;
        moons
    }
}

/// One roll of an initializer's walk, each distance and angle drawn as the add-system roller
/// draws it. A block's count is not drawn: every roll spawns its rounded midpoint, as
/// [`initializers::expand`] does, so each body meets its details by id.
struct Example {
    rng: Rng,
    bodies: Vec<RolledBody>,
}

impl<'p> Walk<'p> for Example {
    type Number = f64;
    type Error = Infallible;

    fn count(&mut self, block: &'p InitPlanet) -> u32 {
        block.instances()
    }

    fn distance(&mut self, distance: Range) -> f64 {
        draw::distance(&mut self.rng, distance)
    }

    fn angle(&mut self, angle: Range) -> f64 {
        draw::angle(&mut self.rng, angle)
    }

    fn no_angle(&mut self) -> f64 {
        draw::any_angle(&mut self.rng)
    }

    fn body(&mut self, block: &'p InitPlanet, placed: Placed<f64>) -> Result<(), Infallible> {
        self.bodies.push(RolledBody {
            id: planet_id(self.bodies.len()),
            orbit: placed.orbit,
            angle: placed.angle.rem_euclid(360.0),
            base: placed.base,
            from: placed.from.rem_euclid(360.0),
        });
        orbit_walk::walk(&block.moons, self)
    }
}

/// How far inside the radius they must fit the outermost placeholder planet stays.
const PLACEHOLDER_MARGIN: f64 = 20.0;

/// The seed of roll `roll` of system `id`.
fn roll_seed(id: u32, roll: u32) -> u64 {
    (u64::from(id) << 32) | u64::from(roll)
}

fn bounds(range: Range) -> Bounds {
    Bounds {
        min: range.min,
        max: range.max,
    }
}

fn system_resources(planets: &[PlanetSummary]) -> Vec<ResourceAmount> {
    let mut rows = Vec::new();
    for row in planets.iter().flat_map(|p| &p.deposits) {
        add(&mut rows, &row.resource, row.amount);
    }
    rows
}

fn add(rows: &mut Vec<ResourceAmount>, resource: &str, amount: f64) {
    match rows.iter_mut().find(|r| r.resource == resource) {
        Some(row) => row.amount += amount,
        None => rows.push(ResourceAmount {
            resource: resource.to_owned(),
            amount,
        }),
    }
}

/// Each deposit key with how often the initializer places it, in first-seen order.
fn deposit_counts(keys: &[String]) -> Vec<DepositCount> {
    let mut counts: Vec<DepositCount> = Vec::new();
    for key in keys {
        match counts.iter_mut().find(|d| d.key == *key) {
            Some(d) => d.count += 1,
            None => counts.push(DepositCount {
                key: key.clone(),
                count: 1,
            }),
        }
    }
    counts
}

/// The synthetic id of the `n`th body [`initializers::expand`] gives.
fn planet_id(n: usize) -> u32 {
    PLANET_BASE + index(n)
}

/// What a scenario draws a system's star as while the game has yet to pick it.
pub const RANDOM_STAR_CLASS: &str = "sc_g";

pub(crate) fn star_class_of(init: Option<&Initializer>) -> &str {
    init.and_then(|init| init.class.as_deref())
        .filter(|class| class.starts_with("sc_"))
        .unwrap_or(RANDOM_STAR_CLASS)
}

/// Never [`u32::MAX`]: the format's null id.
fn index(n: usize) -> u32 {
    u32::try_from(n).unwrap_or(u32::MAX - 1)
}
