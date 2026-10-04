//! The bodies a seed rolls, pinned by snapshot under `snapshots/generate`, on a
//! hand-written install and on the real one.

use crate::common;

use sgf_core::ops::{BeltSpec, BodySpec, SystemSpec};
use sgf_gamedata::generate::generate;

use common::layouts::{self, by_name};
use common::{ABUNDANCE, INSTALL, SPOT};

/// `spec` as the snapshot `name` under `snapshots/generate`: the system on the first line,
/// then its belts, then one line per body, each moon under its planet. Every field is
/// named, so a new one fails to compile until it is rendered. A snapshot of the real
/// install changes when a game update changes the layouts, classes or deposits it reads.
fn pinned(name: &str, spec: &SystemSpec) {
    let SystemSpec {
        name: system,
        x,
        y,
        star_class,
        initializer,
        capped,
        star_named_by_class,
        star,
        planets,
        belts,
        flags,
        lanes,
    } = spec;
    let mut out = format!("{system} at {x} {y} {star_class} {initializer}");
    if *capped {
        out.push_str(" capped");
    }
    if *star_named_by_class {
        out.push_str(" star_named_by_class");
    }
    if !flags.is_empty() {
        out.push_str(&format!(" flags {flags:?}"));
    }
    if !lanes.is_empty() {
        out.push_str(&format!(" lanes {lanes:?}"));
    }
    out.push('\n');
    for BeltSpec { kind, inner_radius } in belts {
        out.push_str(&format!("belt {kind} {inner_radius}\n"));
    }
    body_line(&mut out, "", star);
    for planet in planets {
        body_line(&mut out, "  ", planet);
    }
    insta::with_settings!({snapshot_path => "snapshots/generate", prepend_module_to_snapshot => false}, {
        insta::assert_snapshot!(name, out);
    });
}

/// `body` on a line of its own below `indent`, then its moons one level further in.
fn body_line(out: &mut String, indent: &str, body: &BodySpec) {
    let BodySpec {
        class,
        size,
        orbit,
        angle,
        entity,
        deposits,
        moons,
        asteroid,
        name,
        entity_name,
        modifiers,
        ring,
        star,
    } = body;
    let mut line = format!("{indent}{class} {size} orbit {orbit} angle {angle}");
    if *entity != 0 {
        line.push_str(&format!(" entity {entity}"));
    }
    if !deposits.is_empty() {
        line.push_str(&format!(" deposits {deposits:?}"));
    }
    for (set, word) in [(star, "star"), (asteroid, "asteroid"), (ring, "ring")] {
        if *set {
            line.push(' ');
            line.push_str(word);
        }
    }
    if let Some(name) = name {
        line.push_str(&format!(" name {name}"));
    }
    if let Some(entity) = entity_name {
        line.push_str(&format!(" entity_name {entity}"));
    }
    if !modifiers.is_empty() {
        line.push_str(&format!(" modifiers {modifiers:?}"));
    }
    out.push_str(&line);
    out.push('\n');
    for moon in moons {
        body_line(out, &format!("{indent}  "), moon);
    }
}

#[test]
fn a_hand_written_install_rolls_the_same_bodies_for_a_seed_as_before() {
    let (_dir, gd) = layouts::hand_written();
    for seed in [1, 2] {
        let spec = generate(&gd, seed, "Fx", (1.0, 2.0), None, ABUNDANCE).unwrap();
        pinned(&format!("fx_random_{seed}"), &spec);
    }
    let spec = by_name(&gd, 1, "Fx", (1.0, 2.0), "fx_haven").unwrap();
    pinned("fx_haven_1", &spec);
    let spec = generate(&gd, 3, "Fx", (1.0, 2.0), Some("sc_hole"), ABUNDANCE).unwrap();
    pinned("fx_hole_3", &spec);
}

#[test]
fn the_real_install_rolls_the_same_bodies_for_a_seed_as_before() {
    let Some(gd) = INSTALL.as_ref() else {
        return;
    };
    for seed in [1, 5] {
        let spec = generate(gd, seed, "Gen", SPOT, None, ABUNDANCE).unwrap();
        pinned(&format!("random_{seed}"), &spec);
    }
    let spec = generate(gd, 1, "Gen", SPOT, Some("sc_pulsar"), ABUNDANCE).unwrap();
    pinned("pulsar_1", &spec);
    for (layout, seed) in [
        ("trappist_initializer", 1),
        ("previously_terraformed_planet_system_initializer", 1),
        ("wenkwort_initializer", 3),
        ("debris_belt_initializer", 3),
    ] {
        let spec = by_name(gd, seed, "Gen", SPOT, layout).unwrap();
        pinned(&format!("{layout}_{seed}"), &spec);
    }
}
