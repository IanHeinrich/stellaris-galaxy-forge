//! Where a scenario system's details say each statement, body, inline script and `@variable`
//! is written, so the app can open the file at that line: each position read back from the
//! file on disk, on a hand-written install and the real one.

use std::fs;

use sgf_core::views::details::{SourceLine, SystemDetails};

use crate::common;

use common::INSTALL;

const STARS: &str = "sc_sun = {
	class = sun_star
	planet = { key = pc_sun_star }
	spawn_odds = 30
}
";

const PLANETS: &str = "pc_sun_star = { star = yes planet_size = { min = 20 max = 30 } }
pc_rock = { planet_size = { min = 10 max = 20 } }
";

const VARIABLES: &str = "@fx_far = 30
@fx_size = 14
";

/// A block as written, and one read with a multi-line inline script call in place, with a
/// statement after the call.
const INITIALIZERS: &str = "@fx_local = 25
fx_plain = {
	class = sc_sun
	planet = { class = star orbit_distance = 0 }
	planet = {
		class = pc_rock
		orbit_distance = @fx_local
		size = @fx_size
		init_effect = {
			fx_unknown_effect = yes
		}
	}
	fx_unknown_key = yes
}
fx_spliced = {
	inline_script = {
		script = fx/bodies
		SIZE = 12
	}
	fx_after_script = yes
}
";

const BODIES: &str = "# The bodies, for fx_spliced.
class = sc_sun
planet = { class = star orbit_distance = 0 }
planet = {
	class = pc_rock
	orbit_distance = 30
	size = $SIZE$
	fx_script_key = yes
}
";

const INITIALIZERS_FILE: &str = "common/solar_system_initializers/00_fx.txt";
const VARIABLES_FILE: &str = "common/scripted_variables/00_fx.txt";
const BODIES_FILE: &str = "common/inline_scripts/fx/bodies.txt";

fn install() -> (tempfile::TempDir, sgf_gamedata::GameData) {
    common::hand_written(&[
        ("common/star_classes/00_stars.txt", STARS),
        ("common/planet_classes/00_planets.txt", PLANETS),
        (VARIABLES_FILE, VARIABLES),
        (BODIES_FILE, BODIES),
        (INITIALIZERS_FILE, INITIALIZERS),
    ])
}

/// The line `at` names, read from its file.
fn line_at(at: &SourceLine) -> String {
    let text = fs::read_to_string(&at.file).unwrap_or_else(|e| panic!("{}: {e}", at.file));
    let index = usize::try_from(at.line).expect("a line number") - 1;
    text.lines()
        .nth(index)
        .unwrap_or_else(|| panic!("{} has no line {}", at.file, at.line))
        .to_owned()
}

/// `at` is the line of `text`, the content of the install file `rel`, that `needle` is the
/// whole of, and that line on disk is the same.
fn assert_at(at: Option<&SourceLine>, rel: &str, text: &str, needle: &str) {
    let at = at.unwrap_or_else(|| panic!("a position for {needle}"));
    assert!(
        at.file.replace('\\', "/").ends_with(rel),
        "{needle}: {} is not {rel}",
        at.file
    );
    let expected = text
        .lines()
        .position(|line| line.trim() == needle)
        .unwrap_or_else(|| panic!("{rel} writes {needle}"))
        + 1;
    assert_eq!(at.line as usize, expected, "{needle}'s line in {rel}");
    assert_eq!(line_at(at).trim(), needle, "{rel} on disk");
}

fn details(gd: &sgf_gamedata::GameData, key: &str) -> SystemDetails {
    gd.initializer_details(1, key, None)
        .unwrap_or_else(|| panic!("{key}'s details"))
}

#[test]
fn a_blocks_statements_bodies_and_variables_are_where_its_file_writes_them() {
    let (_dir, gd) = install();
    let details = details(&gd, "fx_plain");
    let spawn = details.spawn.as_ref().expect("a scenario system's spawn");
    let [unknown] = spawn.other_keys.as_slice() else {
        panic!("one key the reader does not model: {:?}", spawn.other_keys);
    };
    assert_at(
        unknown.at.as_ref(),
        INITIALIZERS_FILE,
        INITIALIZERS,
        "fx_unknown_key = yes",
    );

    let bodies: Vec<_> = details
        .planets
        .iter()
        .map(|p| p.spawn.as_ref().expect("a body's spawn"))
        .collect();
    assert_at(
        bodies[0].at.as_ref(),
        INITIALIZERS_FILE,
        INITIALIZERS,
        "planet = { class = star orbit_distance = 0 }",
    );
    let rock = bodies[1];
    assert_at(
        rock.at.as_ref(),
        INITIALIZERS_FILE,
        INITIALIZERS,
        "planet = {",
    );
    assert_at(
        rock.script[0].at.as_ref(),
        INITIALIZERS_FILE,
        INITIALIZERS,
        "fx_unknown_effect = yes",
    );

    let variables: Vec<(&str, Option<&SourceLine>)> = rock
        .variables
        .iter()
        .map(|v| (v.variable.as_str(), v.at.as_ref()))
        .collect();
    let [(local, local_at), (global, global_at)] = variables.as_slice() else {
        panic!("two @variables: {variables:?}");
    };
    assert_eq!((*local, *global), ("@fx_local", "@fx_size"));
    assert_at(*local_at, INITIALIZERS_FILE, INITIALIZERS, "@fx_local = 25");
    assert_at(*global_at, VARIABLES_FILE, VARIABLES, "@fx_size = 14");
}

#[test]
fn what_an_inline_script_supplies_is_where_the_scripts_file_writes_it() {
    let (_dir, gd) = install();
    let details = details(&gd, "fx_spliced");
    let spawn = details.spawn.as_ref().expect("a scenario system's spawn");
    let [script] = spawn.inline_scripts.as_slice() else {
        panic!(
            "one inline script read in place: {:?}",
            spawn.inline_scripts
        );
    };
    assert_at(script.at.as_ref(), BODIES_FILE, BODIES, "class = sc_sun");

    let bodies: Vec<_> = details
        .planets
        .iter()
        .map(|p| p.spawn.as_ref().expect("a body's spawn"))
        .collect();
    assert_at(
        bodies[0].at.as_ref(),
        BODIES_FILE,
        BODIES,
        "planet = { class = star orbit_distance = 0 }",
    );
    assert_at(bodies[1].at.as_ref(), BODIES_FILE, BODIES, "planet = {");
    let block = bodies[1].at.as_ref().expect("its block");
    let last = block.last.expect("a block over several lines");
    let closing = SourceLine {
        line: last,
        ..block.clone()
    };
    assert_eq!(line_at(&closing), "}");
    assert_eq!(bodies[0].at.as_ref().and_then(|at| at.last), None);
    let [script_key] = bodies[1].other_keys.as_slice() else {
        panic!(
            "one key the reader does not model: {:?}",
            bodies[1].other_keys
        );
    };
    assert_at(
        script_key.at.as_ref(),
        BODIES_FILE,
        BODIES,
        "fx_script_key = yes",
    );

    let [after] = spawn.other_keys.as_slice() else {
        panic!("one key the reader does not model: {:?}", spawn.other_keys);
    };
    assert_at(
        after.at.as_ref(),
        INITIALIZERS_FILE,
        INITIALIZERS,
        "fx_after_script = yes",
    );
}

/// The real install's positions, read back from its files: each body's line opens its
/// `planet` or `moon` block, each statement's line writes its key, each `@variable`'s line
/// defines it, and each inline script is its script's file. Sol; a basic layout with an
/// `@variable` from `scripted_variables`; a void worm system read through its inline script.
#[test]
fn the_real_installs_positions_are_the_lines_its_files_write() {
    let Some(gd) = INSTALL.as_ref() else {
        return;
    };
    for key in [
        "sol_system_initializer",
        "basic_init_01",
        "voidworms_spawn_system_tiny",
        "dyson_sphere_init_01",
    ] {
        let details = details(gd, key);
        let spawn = details.spawn.as_ref().expect("a scenario system's spawn");
        let mut statements: Vec<_> = spawn.other_keys.iter().chain(&spawn.script).collect();
        let mut variables: Vec<_> = spawn.variables.iter().collect();
        for planet in &details.planets {
            let body = planet.spawn.as_ref().expect("a body's spawn");
            let opens = line_at(body.at.as_ref().expect("a body's position"));
            let opens = opens.trim_start();
            assert!(
                opens.starts_with("planet") || opens.starts_with("moon"),
                "{key}: a body's line is {opens}"
            );
            statements.extend(body.other_keys.iter().chain(&body.script));
            variables.extend(&body.variables);
        }
        for statement in statements {
            let line = line_at(statement.at.as_ref().expect("a statement's position"));
            assert!(
                line.contains(&statement.key),
                "{key}: {}'s line is {line}",
                statement.key
            );
        }
        for variable in variables {
            let line = line_at(variable.at.as_ref().expect("a defined variable's position"));
            assert!(
                line.trim_start().starts_with(&variable.variable),
                "{key}: {}'s line is {line}",
                variable.variable
            );
        }
        for script in &spawn.inline_scripts {
            let at = script.at.as_ref().expect("an inline script's position");
            assert!(
                at.file
                    .replace('\\', "/")
                    .ends_with(&format!("common/inline_scripts/{}.txt", script.script)),
                "{key}: {} is not {}'s file",
                at.file,
                script.script
            );
        }
    }
    let basic = details(gd, "basic_init_01");
    assert!(
        basic
            .planets
            .iter()
            .filter_map(|p| p.spawn.as_ref())
            .any(|s| !s.variables.is_empty()),
        "basic_init_01 writes an @variable"
    );
    let worms = details(gd, "voidworms_spawn_system_tiny");
    assert!(
        worms.spawn.is_some_and(|s| !s.inline_scripts.is_empty()),
        "the void worm system reads an inline script"
    );
}
