//! What a scenario system shows in place of the save's details projection: everything its
//! initializer statically defines, in the [`SystemDetails`] shape a save answers with.
//!
//! Effects a scripted effect hides (`spawn_dreadnought = yes`) are not resolved, so a
//! system shows what its initializer file writes out and nothing more.

use sgf_core::format::save::details::{
    ArchaeologySite, DepositCount, DetailsResolver, FleetPresence, MegastructureSummary,
    PlanetSummary, ResourceAmount, StarbaseSummary, SystemDetails,
};
use sgf_core::projections::name::NameTemplate;

use crate::GameData;
use crate::initializers::{self, Body, BodyClass, Initializer};
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
            belts: Vec::new(),
            inner_radius: None,
        })
    }

    fn bodies(&self, init: &Initializer) -> Bodies {
        let mut out = Bodies::default();
        let star = init
            .class
            .as_deref()
            .filter(|class| self.star_classes.get(class).is_some());
        for body in initializers::expand(&init.planets) {
            let id = PLANET_BASE + index(out.planets.len());
            out.planets.push(self.summary(body, star, id));
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

    /// `star` is the initializer's own star class, which the body written as `star` wears.
    fn summary(&self, expanded: Body<'_>, star: Option<&str>, id: u32) -> PlanetSummary {
        let body = expanded.block;
        let name_key = body.name.clone().unwrap_or_default();
        let class = match star {
            Some(star) if body.class == BodyClass::Star => star.to_owned(),
            _ => body.class.written().to_owned(),
        };
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
            habitable: self.planet_habitable(body.class.written()),
            owner: None,
            moon: expanded.moon,
            pre_ftl: body.pre_ftl,
            size: body.size.map(|(min, _)| min),
            orbit: None,
            deposits: self.deposit_rows(&body.deposits),
            deposit_keys: deposit_counts(&body.deposits),
            pops: 0,
            parent: expanded.parent.map(|parent| PLANET_BASE + index(parent)),
            layout: None,
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

/// Never [`u32::MAX`]: the format's null id.
fn index(n: usize) -> u32 {
    u32::try_from(n).unwrap_or(u32::MAX - 1)
}
