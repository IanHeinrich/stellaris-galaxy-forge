//! What the install's initializers place in their systems beside bodies: the ambient objects
//! they create and the megastructures they spawn with no owner, read from what each
//! initializer already holds of its system's and bodies' effects and of the scripted effects
//! they call.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::GameData;
use crate::initializers::{self, Body, InitPlanet};
use crate::layouts::star_body;
use crate::stated;
use crate::structure_spawns::WrittenPlace;
use crate::structures;

/// How an initializer places an ownerless megastructure.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum RuinPlacement {
    /// `random_pos = yes`: a spot the game picks.
    Random,
    /// On the system's star.
    Star,
    /// On a planet or moon, or wherever a scope of the system's bodies puts it.
    Planet,
    /// At a point of its own: an orbit about the centre, the centre, or another object's point.
    Point,
}

/// A megastructure type the initializers spawn with no owner.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct InitializerRuin {
    pub kind: String,
    /// Every way an initializer places it, in [`RuinPlacement`]'s order.
    pub placements: Vec<RuinPlacement>,
    /// The initializers that spawn it, by key.
    pub placed_by: Vec<String>,
}

impl GameData {
    /// Every ambient object type the initializers create, with the initializers that create
    /// it, in key order. Worked out the first time it is asked for.
    pub fn ambient_objects_placed(&self) -> &BTreeMap<String, Vec<String>> {
        self.ambient_placed.get_or_init(|| {
            let mut placed: BTreeMap<String, BTreeSet<&str>> = BTreeMap::new();
            for init in self.initializers.iter() {
                let bodies: Vec<Body<'_>> = initializers::expand(&init.planets).collect();
                let mut kinds = init.stated.ambient_objects.clone();
                each_block(&init.planets, &mut |block| {
                    kinds.extend(block.stated.ambient_objects.iter().cloned());
                });
                for called in structures::calls(self, init, &bodies) {
                    let effect = called.def;
                    kinds.extend(stated::ambient_objects(&effect.node, &effect.src, false));
                }
                for kind in kinds {
                    placed.entry(kind).or_default().insert(&init.name);
                }
            }
            placed
                .into_iter()
                .map(|(kind, by)| (kind, by.into_iter().map(str::to_owned).collect()))
                .collect()
        })
    }

    /// Every megastructure type the initializers spawn with no `owner`, with how and by which
    /// initializers, in key order. Worked out the first time it is asked for.
    pub fn initializer_ruins(&self) -> &[InitializerRuin] {
        self.ruins.get_or_init(|| {
            let mut ruins: BTreeMap<String, (BTreeSet<RuinPlacement>, BTreeSet<&str>)> =
                BTreeMap::new();
            for init in self.initializers.iter() {
                let bodies: Vec<Body<'_>> = initializers::expand(&init.planets).collect();
                let called = structures::calls(self, init, &bodies);
                for (spawn, from, _) in structures::spawns(init, &bodies, &called) {
                    if spawn.owner.is_some() {
                        continue;
                    }
                    let (placements, by) = ruins.entry(spawn.kind.clone()).or_default();
                    placements.insert(self.placement(&spawn.place, &bodies, from));
                    by.insert(&init.name);
                }
            }
            ruins
                .into_iter()
                .map(|(kind, (placements, by))| InitializerRuin {
                    kind,
                    placements: placements.into_iter().collect(),
                    placed_by: by.into_iter().map(str::to_owned).collect(),
                })
                .collect()
        })
    }

    /// How `place` stands, written in body `from`'s block or call when it is.
    fn placement(
        &self,
        place: &WrittenPlace,
        bodies: &[Body<'_>],
        from: Option<usize>,
    ) -> RuinPlacement {
        let star = |i: usize| star_body(self, &bodies[i].block.class);
        match place {
            WrittenPlace::Random => RuinPlacement::Random,
            WrittenPlace::Planet(target) => {
                let body = match target.as_str() {
                    "star" => return RuinPlacement::Star,
                    "this" | "prev" => from,
                    _ => initializers::saved_body(bodies, target, from),
                };
                match body.is_some_and(star) {
                    true => RuinPlacement::Star,
                    false => RuinPlacement::Planet,
                }
            }
            WrittenPlace::BodyScope(_) => RuinPlacement::Planet,
            WrittenPlace::Centre
            | WrittenPlace::Orbit { .. }
            | WrittenPlace::CoordsFrom(_)
            | WrittenPlace::UnreadOrbit(_) => RuinPlacement::Point,
        }
    }
}

/// `f` of every `planet` and `moon` block below `planets`, once each.
fn each_block<'p>(planets: &'p [InitPlanet], f: &mut impl FnMut(&'p InitPlanet)) {
    for block in planets {
        f(block);
        each_block(&block.moons, f);
    }
}
