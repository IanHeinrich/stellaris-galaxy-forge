//! What a scenario system's details say only an initializer states, on the real install: a
//! few vanilla initializers pinned one body a line under `snapshots/details_spawn`, and what
//! each body can roll.

use sgf_core::format::save::details::{
    BodyRole, Bounds, ClassPool, SpawnClass, SpawnPool, SpawnRing, SystemDetails,
};
use sgf_gamedata::details::ClassRollsError;

use crate::common::INSTALL;

/// What a body's block can state of it beyond its layout, shown on its line only when stated.
const STATED_BODY: [&str; 5] = [
    "entity",
    "changed_class",
    "changed_size",
    "starting_planet",
    "home_planet",
];

/// `details` as the snapshot `key` under `snapshots/details_spawn`: the system's star, counts,
/// radii, scripts and ambient objects, then each body on one line with its place in the
/// layout and what its block states. The positions are left out: they name this machine's files, and `details_at` reads
/// them back.
fn pinned(key: &str, details: &SystemDetails) {
    let details = &without_positions(details);
    let spawn = details.spawn.as_ref().expect("a scenario system's spawn");
    let system = picked(
        spawn,
        &[
            "star",
            "planets",
            "moons",
            "asteroids",
            "inner_radius",
            "belt_radii",
            "variables",
            "inline_scripts",
            "from_script",
            "ambient_objects",
        ],
    );
    let mut out = format!(
        "{}\nmegastructures {}\n",
        serde_json::Value::Object(system),
        details.megastructures.len()
    );
    for planet in &details.planets {
        let mut line = picked(
            planet,
            &["id", "role", "parent", "class", "star_class", "layout"],
        );
        let spawn = planet.spawn.as_ref().expect("a body's spawn");
        line.extend(picked(spawn, &["always", "copy", "count", "orbit_fit"]));
        let stated = picked(spawn, &STATED_BODY);
        line.extend(
            stated
                .into_iter()
                .filter(|(_, v)| !v.is_null() && v != false),
        );
        out.push_str(&serde_json::Value::Object(line).to_string());
        out.push('\n');
    }
    insta::with_settings!({snapshot_path => "snapshots/details_spawn", prepend_module_to_snapshot => false}, {
        insta::assert_snapshot!(key, out);
    });
}

/// The fields `keys` of `value` as serialised, null where it leaves one out.
fn picked(
    value: &impl serde::Serialize,
    keys: &[&str],
) -> serde_json::Map<String, serde_json::Value> {
    let serde_json::Value::Object(mut fields) = serde_json::to_value(value).expect("serialises")
    else {
        panic!("an object");
    };
    keys.iter()
        .map(|&key| (key.to_owned(), fields.remove(key).unwrap_or_default()))
        .collect()
}

fn without_positions(details: &SystemDetails) -> SystemDetails {
    let mut details = details.clone();
    let spawns = details.planets.iter_mut().filter_map(|p| p.spawn.as_mut());
    for body in spawns {
        body.at = None;
        for statement in body.other_keys.iter_mut().chain(&mut body.script) {
            statement.at = None;
        }
        body.variables.iter_mut().for_each(|v| v.at = None);
    }
    if let Some(spawn) = details.spawn.as_mut() {
        for statement in spawn.other_keys.iter_mut().chain(&mut spawn.script) {
            statement.at = None;
        }
        spawn.variables.iter_mut().for_each(|v| v.at = None);
        spawn.inline_scripts.iter_mut().for_each(|s| s.at = None);
    }
    let structures = details
        .megastructures
        .iter_mut()
        .filter_map(|m| m.spawn.as_mut());
    let starbase = details.starbase.iter_mut().filter_map(|s| s.spawn.as_mut());
    structures.chain(starbase).for_each(|s| s.at = None);
    details
}

/// One vanilla initializer per shape the reader handles: Sol; a trinary with planets around
/// its companion stars; a basic layout of ranged counts on a random star list, with an
/// `@variable`; a void worm system, read through its inline script; ambient objects beside a
/// megastructure; an empire start with `ideal_planet_class`; and moons of moons. No vanilla
/// initializer digs a site from the system's own effects, so the hand-written install in
/// `details_spawn.rs` covers that.
/// Then a system-level `change_orbit` written as a range, a belt whose `radius` is a range
/// beside a drawn class near the star that no class fits, and a `count` with only a `min`.
#[test]
fn the_real_installs_scenario_details_are_pinned() {
    let Some(gd) = INSTALL.as_ref() else {
        return;
    };
    for key in [
        "sol_system_initializer",
        "trinary_init_02",
        "basic_init_01",
        "voidworms_spawn_system_tiny",
        "dyson_sphere_init_01",
        "random_empire_init_05",
        "fallen_hive_control_3",
        "legendary_leader_1st_site",
        "overlord_system_8_init",
        "astral_scar_system",
    ] {
        let details = gd
            .initializer_details(1, key, None)
            .unwrap_or_else(|| panic!("{key}'s details"));
        pinned(key, &details);
    }
}

/// What the game can roll for each body of `details`, one line a body, as the snapshot `key`
/// under `snapshots/details_spawn`.
fn rolls(key: &str, details: &SystemDetails) {
    let spawn = details.spawn.as_ref().expect("a scenario system's spawn");
    let mut out = format!(
        "inner_radius {}\nbelt_radii {}\nresources {}\n",
        serde_json::to_string(&spawn.inner_radius).expect("serialises"),
        serde_json::to_string(&spawn.belt_radii).expect("serialises"),
        serde_json::to_string(&details.resources).expect("serialises"),
    );
    for planet in &details.planets {
        let spawn = planet.spawn.as_ref().expect("a body's spawn");
        let line = serde_json::json!({
            "class": planet.class,
            "always": spawn.always,
            "pool": spawn.class,
            "orbit_fit": spawn.orbit_fit,
            "ring": spawn.ring,
            "deposits": spawn.deposits,
            "rolled_deposits": spawn.rolled_deposits,
            "rolled_features": spawn.rolled_features,
            "naming": spawn.naming,
        });
        out.push_str(&line.to_string());
        out.push('\n');
    }
    insta::with_settings!({snapshot_path => "snapshots/details_spawn", prepend_module_to_snapshot => false}, {
        insta::assert_snapshot!(format!("rolls_{key}"), out);
    });
}

/// What the game rolls beside what an initializer states, on vanilla initializers that show
/// each roll: a drawn class near the star that no class fits, and a ranged belt; deposits
/// both stated and rolled; a fixed class that rolls a ring; an unnamed system's bodies, with
/// numerals that depend on ranged counts; a planet list drawn at its orbit.
#[test]
fn the_real_installs_rolls_are_pinned() {
    let Some(gd) = INSTALL.as_ref() else {
        return;
    };
    for key in [
        "overlord_system_8_init",
        "high_energy_system",
        "ai_system_04",
        "basic_init_01",
        "guardians_init_fortress",
    ] {
        let details = gd
            .initializer_details(1, key, None)
            .unwrap_or_else(|| panic!("{key}'s details"));
        rolls(key, &details);
    }
}

/// The keys of a rolled pool; empty for a pool that rolls nothing.
fn pool_keys(pool: &SpawnPool) -> Vec<&str> {
    match pool {
        SpawnPool::Rolled { entries } => entries.iter().map(|e| e.key.as_str()).collect(),
        SpawnPool::Fixed | SpawnPool::Unknown => Vec::new(),
    }
}

/// What a drawn body rolls as each class it can be drawn is part of what it rolls as any of
/// them, and what a body whose block names its class rolls as that class is what its spawn
/// says it rolls.
#[test]
fn a_body_rolls_as_one_class_a_part_of_its_pool() {
    let Some(gd) = INSTALL.as_ref() else {
        return;
    };
    let details = gd
        .initializer_details(1, "ai_system_04", None)
        .expect("ai_system_04's details");
    let mut drawn = 0;
    let mut ringed = 0;
    for planet in &details.planets {
        let spawn = planet.spawn.as_ref().expect("a body's spawn");
        let SpawnClass::Rolled {
            pool:
                ClassPool::Random {
                    at_orbit: Some(classes),
                    ..
                },
        } = &spawn.class
        else {
            continue;
        };
        if classes.len() < 2 {
            continue;
        }
        drawn += 1;
        let deposits = pool_keys(spawn.rolled_deposits.as_ref().expect("rolled deposits"));
        let features = pool_keys(spawn.rolled_features.as_ref().expect("rolled features"));
        for class in classes {
            let rolls = gd
                .class_rolls("ai_system_04", planet.id, &class.class)
                .unwrap_or_else(|e| panic!("body {} as {}: {e}", planet.id, class.class));
            assert_eq!(rolls.class, class.class);
            assert!(
                matches!(rolls.deposits, SpawnPool::Rolled { .. }),
                "{} rolls deposits",
                class.class
            );
            for key in pool_keys(&rolls.deposits) {
                assert!(deposits.contains(&key), "{key} as {}", class.class);
            }
            for key in pool_keys(&rolls.features) {
                assert!(features.contains(&key), "{key} as {}", class.class);
            }
            let def = gd.planet_classes.get(&class.class).expect("a drawn class");
            let moon = planet.role == BodyRole::Moon;
            let stated = planet.layout.as_ref().and_then(|l| l.size);
            let class_size = def.size(moon).map(|r| Bounds {
                min: r.min,
                max: r.max,
            });
            assert_eq!(rolls.size, stated.or(class_size), "size as {}", class.class);
            if moon {
                assert_eq!(
                    rolls.ring,
                    SpawnRing::Fixed { ring: false },
                    "a moon's ring"
                );
                ringed += 1;
            } else if !matches!(spawn.ring, Some(SpawnRing::Fixed { .. })) {
                let ring = if def.chance_of_ring > 0.0 {
                    SpawnRing::Rolled {
                        chance: Some(def.chance_of_ring),
                    }
                } else {
                    SpawnRing::Fixed { ring: false }
                };
                assert_eq!(rolls.ring, ring, "ring as {}", class.class);
                ringed += 1;
            }
        }
    }
    assert!(ringed > 0, "a drawn body's ring is left to its class");
    assert!(
        drawn > 0,
        "ai_system_04 has bodies drawn from several classes"
    );

    let toxic = details
        .planets
        .iter()
        .find(|p| matches!(&p.spawn.as_ref().expect("a spawn").class, SpawnClass::Fixed { class } if class == "pc_toxic"))
        .expect("ai_system_04's toxic world");
    let spawn = toxic.spawn.as_ref().expect("a spawn");
    let rolls = gd
        .class_rolls("ai_system_04", toxic.id, "pc_toxic")
        .expect("a toxic world rolls as one");
    assert_eq!(Some(&rolls.deposits), spawn.rolled_deposits.as_ref());
    assert_eq!(Some(&rolls.features), spawn.rolled_features.as_ref());
    assert_eq!(Some(rolls.ring), spawn.ring);
    assert_eq!(rolls.size, toxic.layout.as_ref().and_then(|l| l.size));

    assert_eq!(
        gd.class_rolls("ai_system_04", toxic.id, "pc_arid"),
        Err(ClassRollsError::NotRolled {
            body: toxic.id,
            class: "pc_arid".to_owned()
        })
    );
    assert_eq!(
        gd.class_rolls("ai_system_04", 7, "pc_toxic"),
        Err(ClassRollsError::NoBody(7))
    );
}
