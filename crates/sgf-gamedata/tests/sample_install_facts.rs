//! What `fixtures/sample_install` is cut from, read from the real install: run with
//! `--ignored` after a game update and assemble the fixture from the file it writes, as
//! `fixtures/sample_install/README.md` says.

use std::collections::BTreeSet;
use std::fmt::Write as _;
use std::path::PathBuf;

use sgf_core::format::scenario::SEAT_INITIALIZERS;
use sgf_gamedata::GameData;
use sgf_gamedata::initializers::{InitPlanet, Initializer};
use sgf_gamedata::layouts::plain_initializers;

use crate::common;
use crate::common::prepare::samples;

/// The layouts the Prepare tests set or Prepare writes, beside those the samples hold.
const WRITTEN: [&str; 3] = [
    "pre_ftl_init_sol",
    "init_sol_geocentric",
    "sol_system_initializer",
];

/// Writes the facts to `SGF_SAMPLE_INSTALL_FACTS`, or to `sample_install_facts.txt` in the
/// temporary directory, and prints where.
#[test]
#[ignore = "reads the real install to cut the sample install again"]
fn write_the_sample_install_facts() {
    let gd = common::INSTALL.as_ref().expect("a Stellaris install");
    let path = std::env::var_os("SGF_SAMPLE_INSTALL_FACTS")
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::temp_dir().join("sample_install_facts.txt"));
    std::fs::write(&path, facts(gd)).expect("the facts file");
    println!("{}", path.display());
}

fn facts(gd: &GameData) -> String {
    let plain: BTreeSet<&str> = plain_initializers(gd)
        .iter()
        .map(|init| init.name.as_str())
        .collect();
    let mut wanted: BTreeSet<String> = samples()
        .iter()
        .flat_map(|(_, session)| session.graph().systems.values())
        .map(|system| system.initializer.clone())
        .collect();
    wanted.extend(WRITTEN.map(str::to_owned));
    wanted.extend(SEAT_INITIALIZERS.map(|(key, _)| key.to_owned()));
    wanted.extend((1..=6).map(|n| format!("random_empire_init_0{n}")));
    wanted.extend(plain.iter().map(|key| (*key).to_owned()));
    let mut kept: BTreeSet<&str> = BTreeSet::new();
    for key in &wanted {
        kept.extend(gd.initializers.get(key).map(|init| init.name.as_str()));
        kept.extend(
            gd.initializers
                .ancestors(key)
                .iter()
                .map(|a| a.name.as_str()),
        );
    }

    let mut out = String::new();
    let (mut country_types, mut classes, mut planet_classes) =
        (BTreeSet::new(), BTreeSet::new(), BTreeSet::new());
    for init in gd
        .initializers
        .iter()
        .filter(|i| kept.contains(i.name.as_str()))
    {
        let is_plain = plain.contains(init.name.as_str());
        let file = init.source.file_name().expect("a file").to_string_lossy();
        let mode = if is_plain { "plain" } else { "trim" };
        writeln!(out, "init {file} {} {mode}", init.name).unwrap();
        initializer_facts(gd, init, &mut out);
        country_types.extend(init.countries.iter().map(|c| c.country_type.clone()));
        if is_plain {
            classes.extend(init.class.clone());
            init.planets
                .iter()
                .for_each(|p| named_classes(p, &mut planet_classes));
        }
    }
    for key in country_types {
        writeln!(out, "country_type {key}").unwrap();
    }
    for key in classes {
        writeln!(out, "class {key}").unwrap();
    }
    for key in planet_classes {
        let class = gd.planet_classes.get(&key);
        let (star, asteroid) = (
            class.is_some_and(|c| c.star),
            class.is_some_and(|c| c.asteroid),
        );
        writeln!(out, "planet_class {key} {star} {asteroid}").unwrap();
    }
    out
}

/// The lines under an `init` line: what Prepare reads of `init`.
fn initializer_facts(gd: &GameData, init: &Initializer, out: &mut String) {
    for country in &init.countries {
        writeln!(
            out,
            "  country {} {}",
            country.name_key, country.country_type
        )
        .unwrap();
    }
    for spawn in &init.spawns {
        writeln!(out, "  spawn {spawn}").unwrap();
    }
    for (label, value) in [
        ("usage", init.usage.clone()),
        ("class", init.class.clone()),
        ("max", init.max_instances.map(|m| m.to_string())),
        (
            "flags",
            (!init.flags.is_empty()).then(|| init.flags.join(" ")),
        ),
    ] {
        if let Some(value) = value {
            writeln!(out, "  {label} {value}").unwrap();
        }
    }
    match (init.usage_odds, &init.usage_weight) {
        (Some(odds), _) => writeln!(out, "  odds {odds}").unwrap(),
        (None, Some(_)) => writeln!(out, "  odds block").unwrap(),
        (None, None) => {}
    }
    let primitive = gd
        .initializers
        .spliced(&init.name)
        .is_some_and(|def| def.scalar("primitive_system") == Some("yes"));
    for (label, holds) in [
        ("init_effect", init.init_effect),
        ("starbase", init.starbase.is_some()),
        ("inline_script", init.inline_script),
        ("primitive", primitive),
    ] {
        if holds {
            writeln!(out, "  {label}").unwrap();
        }
    }
    init.planets.iter().for_each(|p| pre_ftl(p, out));
}

fn pre_ftl(body: &InitPlanet, out: &mut String) {
    if body.pre_ftl {
        let class = body.class.named().unwrap_or("random");
        writeln!(out, "  preftl {class}").unwrap();
    }
    body.moons.iter().for_each(|moon| pre_ftl(moon, out));
}

fn named_classes(body: &InitPlanet, out: &mut BTreeSet<String>) {
    out.extend(body.class.named().map(str::to_owned));
    body.moons.iter().for_each(|moon| named_classes(moon, out));
}
