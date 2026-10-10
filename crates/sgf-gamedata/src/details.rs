//! What a scenario system shows in place of the save's details projection: everything its
//! initializer statically defines, in the [`SystemDetails`] shape a save answers with.
//!
//! Effects a scripted effect hides (`spawn_dreadnought = yes`) are not resolved, so a
//! system shows what its initializer file writes out and nothing more.

use std::convert::Infallible;

use sgf_core::format::save::details::{
    AmbientObject, AnomalyPrevention, ArchaeologySite, BodyLayout, BodyRole, BodySpawn, Bounds,
    ClassPool, CountRange, DepositCount, DepositReplacement, DepositStep, DetailsResolver,
    FleetPresence, ListMember, MegastructureSummary, NeighborSystem, OrbitFit, PlanetSummary,
    ResourceAmount, SpawnClass, SpawnStar, StarbaseSummary, StatedAnomalies, StatedFeatures,
    SystemDetails, SystemSpawn, UnknownClass,
};
use sgf_core::projections::galaxy::StarClasses;
use sgf_core::projections::name::NameTemplate;

use crate::GameData;
use crate::generate::{belt, generate};
use crate::initializers::{self, Body, BodyClass, InitPlanet, Initializer, body_size};
use crate::install::script::Range;
use crate::layouts::{StarSource, star_body, star_source};
use crate::orbit_walk::{self, Placed, Walk, draw};
use crate::registries::planet_classes::PlanetClassDef;
use crate::registries::star_classes::StarClass;
use crate::rng::Rng;
use crate::rolls::RANDOM_ASTEROID;
use crate::scripts::ScenarioOwners;
use crate::spawn_rolls::Rolls;
use crate::stated::StatedDeposit;
use crate::views::{PlaceholderBody, RolledBody, SystemRoll};

/// Bodies an initializer gives no id: each collection counts from a base far above any id
/// a save or a scenario writes, so a synthetic id never collides with a real one.
const PLANET_BASE: u32 = 0x4000_0000;
const MEGASTRUCTURE_BASE: u32 = 0x5000_0000;
/// A scenario starbase's synthetic id: one per system, never a real entity.
const STARBASE_BASE: u32 = 0x7000_0000;
const SITE_BASE: u32 = 0x6000_0000;

/// The planets and moons one initializer spawns, with the dig sites they carry and the
/// ambient objects their effects create.
#[derive(Debug, Default)]
struct Bodies {
    planets: Vec<PlanetSummary>,
    sites: Vec<ArchaeologySite>,
    ambient_objects: Vec<AmbientObject>,
}

/// The classes an empire at the root of the initializer tree decides.
const IDEAL: [&str; 3] = [
    "ideal_planet_class",
    "ideal_design_class",
    "random_non_ideal",
];

/// How many planets, moons and asteroids an initializer spawns at fewest and most.
#[derive(Debug, Clone, Copy)]
struct Counts {
    planets: CountRange,
    moons: CountRange,
    asteroids: CountRange,
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
            sites,
            ambient_objects,
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
        let resources = system_resources(planets.iter().filter(|p| certain(p)));
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
            wormholes: Vec::new(),
            spawn: Some(SystemSpawn {
                inner_radius: Rolls::new(self, init).inner_radius(init),
                belt_radii: Some(
                    init.asteroid_belts
                        .iter()
                        .filter(|b| belt(b).is_some())
                        .filter_map(|b| b.radius.map(bounds))
                        .collect(),
                ),
                ..self.system_spawn(init, ambient_objects)
            }),
        })
    }

    /// What `init` states of its system beyond a save's fields, `ambient_objects` those its
    /// bodies' effects create.
    fn system_spawn(&self, init: &Initializer, ambient_objects: Vec<AmbientObject>) -> SystemSpawn {
        let stated = &init.stated;
        let counts = (!init.inline_script).then(|| self.counts(&init.planets, None, (1, 1)));
        let mut flags = init.flags.clone();
        flags.extend(stated.flags.iter().cloned());
        let own_objects = stated.ambient_objects.iter().map(|kind| AmbientObject {
            kind: kind.clone(),
            body: None,
        });
        SystemSpawn {
            star: self.spawn_star(init),
            planets: counts.map(|c| c.planets),
            moons: counts.map(|c| c.moons),
            asteroids: counts.map(|c| c.asteroids),
            from_script: stated.from_script.clone(),
            flags,
            namelist: stated.namelist.clone(),
            prevent_anomalies: stated.prevent_anomalies,
            primitive_system: stated.primitive_system,
            inner_radius_offset: stated.inner_radius_offset,
            outer_radius_offset: stated.outer_radius_offset,
            sites: init.sites.clone(),
            ambient_objects: own_objects.chain(ambient_objects).collect(),
            usage: init.usage.clone(),
            usage_odds: stated.usage_odds.clone(),
            spawn_chance: stated.spawn_chance,
            scaled_spawn_chance: stated.scaled_spawn_chance,
            max_instances: init.max_instances,
            neighbors: stated
                .neighbors
                .iter()
                .map(|n| NeighborSystem {
                    initializer: n.initializer.clone(),
                    distance: n.distance.map(bounds),
                    hyperlane_jumps: n.hyperlane_jumps.map(bounds),
                })
                .collect(),
            other_keys: stated.other_keys.clone(),
            script: stated.script.clone(),
            inline_scripts: stated.inline_scripts.clone(),
            variables: stated.variables.clone(),
            inner_radius: None,
            belt_radii: None,
        }
    }

    /// How the game decides `init`'s star class.
    fn spawn_star(&self, init: &Initializer) -> SpawnStar {
        match star_source(self, init) {
            StarSource::Fixed(class) => SpawnStar::Fixed {
                class: class.key.clone(),
            },
            StarSource::List(list) => SpawnStar::Rolled {
                list: list.key.clone(),
                members: list
                    .stars
                    .iter()
                    .map(|key| ListMember {
                        key: key.clone(),
                        weight: self.star_classes.get(key).map(|c| c.spawn_odds),
                    })
                    .collect(),
            },
            StarSource::Unknown => SpawnStar::Unknown {
                written: init.class.clone(),
            },
        }
    }

    /// The planets, moons and asteroids `blocks` spawn at fewest and most, each block of them
    /// spawned `times` as often, around a body of class `parent` when they are its moons.
    fn counts(
        &self,
        blocks: &[InitPlanet],
        parent: Option<&BodyClass>,
        times: (u32, u32),
    ) -> Counts {
        let none = CountRange { min: 0, max: 0 };
        let mut out = Counts {
            planets: none,
            moons: none,
            asteroids: none,
        };
        for block in blocks.iter().filter(|b| !b.spacer()) {
            let copies = block.copies();
            let spawned = (
                times.0.saturating_mul(copies.min),
                times.1.saturating_mul(copies.max),
            );
            let tally = if self.star_block(&block.class) {
                None
            } else if self.asteroid_block(&block.class) {
                Some(&mut out.asteroids)
            } else if parent.is_some_and(|p| !self.star_block(p)) {
                Some(&mut out.moons)
            } else {
                Some(&mut out.planets)
            };
            if let Some(tally) = tally {
                add_count(tally, spawned);
            }
            let inner = self.counts(&block.moons, Some(&block.class), spawned);
            add_count(&mut out.planets, (inner.planets.min, inner.planets.max));
            add_count(&mut out.moons, (inner.moons.min, inner.moons.max));
            add_count(
                &mut out.asteroids,
                (inner.asteroids.min, inner.asteroids.max),
            );
        }
        out
    }

    /// A block written as a star: the bare `star`, a star's planet class or a star class.
    fn star_block(&self, class: &BodyClass) -> bool {
        star_body(self, class)
            || class
                .named()
                .is_some_and(|key| self.star_classes.get(key).is_some())
    }

    /// A block of an asteroid class, or drawn as one.
    fn asteroid_block(&self, class: &BodyClass) -> bool {
        class.named().is_some_and(|key| {
            key == RANDOM_ASTEROID || self.planet_classes.get(key).is_some_and(|c| c.asteroid)
        })
    }

    /// What `body`'s block states of it beyond a save's fields, in a system of `init` whose
    /// star `class` resolves to.
    fn body_spawn(&self, body: Body<'_>, init: &Initializer, class: &str) -> BodySpawn {
        let block = body.block;
        let stated = &block.stated;
        let prevented = match (stated.prevent_anomaly, init.stated.prevent_anomalies) {
            (true, _) => Some(AnomalyPrevention::Body),
            (false, true) => Some(AnomalyPrevention::System),
            (false, false) => None,
        };
        BodySpawn {
            always: body.always,
            copy: body.copy,
            count: block.copies(),
            class: self.spawn_class(block, init, class),
            changed_class: stated.changed_class.clone(),
            changed_size: stated.changed_size,
            deposits: stated
                .deposits
                .iter()
                .map(|d| self.deposit_step(d))
                .collect(),
            no_blockers: stated.no_blockers,
            features: StatedFeatures {
                modifier: stated.modifier.clone(),
                none: stated.no_modifiers,
                cleared: stated.clears_modifiers,
                added: stated.added_modifiers.clone(),
            },
            anomalies: StatedAnomalies {
                categories: stated.anomalies.clone(),
                prevented,
            },
            entity: stated.set_entity.clone().or_else(|| stated.entity.clone()),
            name: stated.set_name.clone(),
            flags: stated.flags.clone(),
            starting_planet: stated.starting_planet,
            home_planet: stated.home_planet,
            other_keys: stated.other_keys.clone(),
            script: stated.script.clone(),
            from_script: stated.from_script.clone(),
            variables: stated.variables.clone(),
            orbit_fit: None,
            ring: None,
            rolled_deposits: None,
            rolled_features: None,
            naming: None,
        }
    }

    /// How the game decides the class of a body of `block` in a system of `init`, `resolved`
    /// the class a star body takes from the system's star class.
    fn spawn_class(&self, block: &InitPlanet, init: &Initializer, resolved: &str) -> SpawnClass {
        let written = block.class.written();
        let unknown = |reason| SpawnClass::Unknown {
            written: written.to_owned(),
            reason,
        };
        if block.stated.class_by_script {
            return unknown(UnknownClass::Script);
        }
        let fixed = |class: &str| SpawnClass::Fixed {
            class: class.to_owned(),
        };
        let random = || SpawnClass::Rolled {
            pool: ClassPool::Random {
                draw: written.to_owned(),
                at_orbit: None,
            },
        };
        let key = match &block.class {
            BodyClass::Star => {
                return match star_source(self, init) {
                    StarSource::Fixed(_) => fixed(resolved),
                    StarSource::List(list) => SpawnClass::Rolled {
                        pool: ClassPool::StarList {
                            list: list.key.clone(),
                        },
                    },
                    StarSource::Unknown => unknown(UnknownClass::Undefined),
                };
            }
            BodyClass::Random(_) => return random(),
            BodyClass::Named(key) => key.as_str(),
        };
        if key == RANDOM_ASTEROID {
            return random();
        }
        if IDEAL.contains(&key) {
            return unknown(UnknownClass::Ideal);
        }
        if self.planet_classes.get(key).is_some() {
            return fixed(key);
        }
        if self.star_classes.get(key).is_some() {
            return fixed(resolved);
        }
        match self.planet_lists.get(key) {
            Some(list) => SpawnClass::Rolled {
                pool: ClassPool::PlanetList {
                    list: key.to_owned(),
                    members: list
                        .iter()
                        .map(|member| ListMember {
                            key: member.clone(),
                            weight: None,
                        })
                        .collect(),
                    at_orbit: None,
                },
            },
            None => unknown(UnknownClass::Undefined),
        }
    }

    fn deposit_step(&self, step: &StatedDeposit) -> DepositStep {
        match step {
            StatedDeposit::Add(deposit) => DepositStep::Add {
                deposit: deposit.clone(),
            },
            StatedDeposit::Set(deposit) => DepositStep::Set {
                deposit: deposit.clone(),
                category: self.deposits.get(deposit).and_then(|d| d.category.clone()),
                replaces: DepositReplacement::Unknown,
            },
            StatedDeposit::Clear(category) => DepositStep::Clear {
                category: category.clone(),
            },
            StatedDeposit::AddBlocker(deposit) => DepositStep::AddBlocker {
                deposit: deposit.clone(),
            },
            StatedDeposit::ClearBlockers => DepositStep::ClearBlockers,
        }
    }

    /// The deposits a body's block states, the steps run in order. Which deposits a
    /// `set_deposit` replaces is not known ([`DepositReplacement::Unknown`]), so it adds its
    /// own and the ones stated before it stay listed.
    fn stated_deposits(&self, steps: &[StatedDeposit]) -> Vec<String> {
        let mut held: Vec<String> = Vec::new();
        for step in steps {
            match step {
                StatedDeposit::Add(key)
                | StatedDeposit::AddBlocker(key)
                | StatedDeposit::Set(key) => held.push(key.clone()),
                StatedDeposit::Clear(None) => held.clear(),
                StatedDeposit::Clear(Some(category)) => held.retain(|key| {
                    self.deposits.get(key).and_then(|d| d.category.as_deref())
                        != Some(category.as_str())
                }),
                StatedDeposit::ClearBlockers => held.retain(|key| !self.is_blocker(key)),
            }
        }
        held
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

    /// Save system details with the star class each star is drawn as, in a system of star
    /// class `system`. Which bodies are stars is the session's to say, from
    /// [`Self::session_star_classes`].
    pub fn resolve_save_bodies(&self, details: &mut SystemDetails, system: &str) {
        for planet in &mut details.planets {
            planet.star_class = self.drawn_star_class(&planet.class, system);
        }
    }

    /// What the install says of stars, for a session: the planet classes flagged `star`, and
    /// the star class each initializer that names one gives a scenario system.
    pub fn session_star_classes(&self) -> StarClasses {
        StarClasses {
            bodies: Some(
                self.planet_classes
                    .iter()
                    .filter(|c| c.star)
                    .map(|c| c.key.clone())
                    .collect(),
            ),
            initializers: self
                .initializers
                .iter()
                .filter_map(|i| {
                    let class = i.class.as_deref().filter(|c| c.starts_with("sc_"))?;
                    Some((i.name.clone(), class.to_owned()))
                })
                .collect(),
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
    /// bodies only through an `inline_script` the install has no text for.
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
        let roles: Vec<BodyRole> = expanded
            .iter()
            .zip(&classes)
            .enumerate()
            .map(|(i, (b, class))| {
                if i == 0 {
                    BodyRole::Primary
                } else if b.parent.is_some_and(|p| !self.is_star_body(&classes[p])) {
                    BodyRole::Moon
                } else if self.is_star_body(class) {
                    BodyRole::Star
                } else {
                    BodyRole::Planet
                }
            })
            .collect();
        let layouts = Layouts::of(&init.planets);
        let walked = expanded.clone();
        let bodies = expanded.into_iter().zip(layouts).zip(classes).zip(roles);
        for (((body, layout), class), role) in bodies {
            let id = planet_id(out.planets.len());
            out.ambient_objects
                .extend(
                    body.block
                        .stated
                        .ambient_objects
                        .iter()
                        .map(|kind| AmbientObject {
                            kind: kind.clone(),
                            body: Some(id),
                        }),
                );
            let mut summary = self.summary(body, class, id, layout, role, system);
            summary.spawn = Some(self.body_spawn(body, init, &summary.class));
            out.planets.push(summary);
            for kind in &body.block.sites {
                out.sites.push(ArchaeologySite {
                    id: SITE_BASE + index(out.sites.len()),
                    kind: kind.clone(),
                    planet: id,
                });
            }
        }
        Rolls::new(self, init).fill(&walked, &mut out.planets);
        out
    }

    /// `class` is the body's planet class, a star's resolved by [`Self::star_body_classes`];
    /// `role` what it is in its system, the first body being the primary; its size and ring follow the
    /// block it is written in, as the generator draws them. `system` is the system's star class.
    fn summary(
        &self,
        expanded: Body<'_>,
        class: String,
        id: u32,
        mut layout: BodyLayout,
        role: BodyRole,
        system: &str,
    ) -> PlanetSummary {
        let body = expanded.block;
        layout.size =
            body_size(Some(body), self.planet_classes.get(&class), expanded.moon).map(bounds);
        let name_key = body.name.clone().unwrap_or_default();
        let habitable = self.planet_habitable(&class);
        let deposits = self.stated_deposits(&body.stated.deposits);
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
            moon: role == BodyRole::Moon,
            role,
            pre_ftl: body.pre_ftl,
            size: layout
                .size
                .filter(|size| size.min == size.max)
                .map(|size| size.min.round() as u32),
            orbit: None,
            deposits: self.deposit_rows(&deposits),
            deposit_keys: deposit_counts(&deposits),
            pops: 0,
            parent: expanded.parent.map(planet_id),
            layout: Some(layout),
            ring: self.ring(body, expanded.moon),
            star_class: self.drawn_star_class(&class, system),
            drawn: Some(self.drawn(&class)),
            permanent_modifiers: None,
            anomaly: None,
            entity_name: None,
            spawn: None,
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
    pub(crate) fn ring(&self, body: &InitPlanet, moon: bool) -> Option<bool> {
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
        block.copies().max
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
/// draws it. A block's count is not drawn: every roll spawns the most it can, as
/// [`initializers::expand`] does, so each body meets its details by id.
struct Example {
    rng: Rng,
    bodies: Vec<RolledBody>,
}

impl<'p> Walk<'p> for Example {
    type Number = f64;
    type Error = Infallible;

    fn count(&mut self, block: &'p InitPlanet) -> u32 {
        block.copies().max
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

/// Whether the game surely spawns `planet`: every copy its block's count allows, around a body
/// it surely spawns, with a class that fits its orbit wherever it lands.
fn certain(planet: &PlanetSummary) -> bool {
    planet.spawn.as_ref().is_none_or(|spawn| {
        spawn.always && spawn.orbit_fit.is_none_or(|fit| fit == OrbitFit::Always)
    })
}

fn system_resources<'p>(planets: impl Iterator<Item = &'p PlanetSummary>) -> Vec<ResourceAmount> {
    let mut rows = Vec::new();
    for row in planets.flat_map(|p| &p.deposits) {
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

fn add_count(tally: &mut CountRange, (min, max): (u32, u32)) {
    tally.min = tally.min.saturating_add(min);
    tally.max = tally.max.saturating_add(max);
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
