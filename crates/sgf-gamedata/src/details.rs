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
use crate::generate::belt;
use crate::initializers::{self, Body, BodyClass, InitPlanet, Initializer};
use crate::install::script::Range;
use crate::orbit_walk::{self, Placed, Turn, Walk};
use crate::registries::planet_classes::PlanetClassDef;
use crate::scripts::ScenarioOwners;

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
    /// System `id`'s details as the initializer `key` defines them; `None` when the
    /// initializer is unknown or defines nothing the UI draws.
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
        if planets.is_empty() && sites.is_empty() && megastructures.is_empty() && starbase.is_none()
        {
            return None;
        }
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
                let keys = self
                    .star_classes
                    .get(star)
                    .map_or(&[][..], |c| c.planet_keys.as_slice());
                let key = keys.get(nth).or_else(|| keys.first());
                nth += 1;
                key.map_or(class, String::as_str).to_owned()
            })
            .collect()
    }

    fn bodies(&self, init: &Initializer) -> Bodies {
        let mut out = Bodies::default();
        let classes = self.star_body_classes(
            star_class_of(Some(init)),
            initializers::expand(&init.planets).map(|body| body.block.class.written()),
        );
        let layouts = Layouts::of(&init.planets);
        for ((body, layout), class) in initializers::expand(&init.planets)
            .zip(layouts)
            .zip(classes)
        {
            let id = PLANET_BASE + index(out.planets.len());
            out.planets.push(self.summary(body, class, id, layout));
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

    /// `class` is the body's planet class, a star's resolved by [`Self::star_body_classes`].
    fn summary(
        &self,
        expanded: Body<'_>,
        class: String,
        id: u32,
        layout: BodyLayout,
    ) -> PlanetSummary {
        let body = expanded.block;
        let name_key = body.name.clone().unwrap_or_default();
        let habitable = self.planet_habitable(&class);
        PlanetSummary {
            id,
            class,
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
            moon: expanded.moon,
            pre_ftl: body.pre_ftl,
            size: body.size.map(|(min, _)| min),
            orbit: None,
            deposits: self.deposit_rows(&body.deposits),
            deposit_keys: deposit_counts(&body.deposits),
            pops: 0,
            parent: expanded.parent.map(|parent| PLANET_BASE + index(parent)),
            layout: Some(layout),
            ring: self.ring(body, expanded.moon),
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
/// kept as the bounds a draw could give. The angles start at 0, so they are right relative
/// to each other and the game may turn the whole system.
struct Layouts(Vec<BodyLayout>);

impl Layouts {
    fn of(planets: &[InitPlanet]) -> Vec<BodyLayout> {
        let mut layouts = Self(Vec::new());
        let Ok(()) = orbit_walk::walk(
            planets,
            Turn::FromPrevious(Bounds::fixed(0.0)),
            &mut layouts,
        );
        layouts.0
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
        self.0.push(BodyLayout {
            orbit: Some(placed.orbit),
            angle: block.orbit_angle.map(|_| within_one_turn(placed.angle)),
            at: None,
            size: block.size.map(|(min, max)| Bounds {
                min: f64::from(min),
                max: f64::from(max),
            }),
        });
        orbit_walk::walk(&block.moons, Turn::FromPrevious(Bounds::fixed(0.0)), self)
    }
}

fn bounds(range: Range) -> Bounds {
    Bounds {
        min: range.min,
        max: range.max,
    }
}

/// `angle` shifted by whole turns until its `min` lies in `[0, 360)`.
fn within_one_turn(angle: Bounds) -> Bounds {
    let shift = angle.min.rem_euclid(360.0) - angle.min;
    Bounds {
        min: angle.min + shift,
        max: angle.max + shift,
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
