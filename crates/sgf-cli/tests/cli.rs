//! Outside-in tests drive the `sgf` binary on the sample save.
use std::path::Path;
use std::process::{Command, Output};

const SAMPLE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../testdata/2206.11.16.sav");
const SCENARIO: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../testdata/2206.11.16.scenario.txt"
);

/// A scenario of the fixture's shape whose system 0 writes both axes as ranges.
const RANGED_SCENARIO: &str = r#"static_galaxy_scenario = {
	name = "sgf_ranged"
	priority = 5
	supports_shape = elliptical
	num_empires = { min = 0 max = 2 }
	num_empire_default = 2
	random_hyperlanes = no
	core_radius = 112.5

	system = { id = "0" name = "Ranged" position = { x = { min = 1 max = 3 } y = { min = 2 max = 4 } } initializer = basic_init_01 }
	system = { id = "1" name = "Fixed" position = { x = 40 y = 50 } initializer = basic_init_02 }

	add_hyperlane = { from = "0" to = "1" }
}
"#;

fn sgf(args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_sgf"))
        .args(args)
        .output()
        .expect("run sgf")
}

fn stdout(out: &Output) -> String {
    String::from_utf8_lossy(&out.stdout).into_owned()
}

#[test]
fn prints_version() {
    let out = sgf(&[]);
    assert!(out.status.success());
    assert!(stdout(&out).starts_with("sgf "));
}

#[test]
fn inspect_reports_header_sections_and_entities() {
    let out = sgf(&["inspect", SAMPLE]);
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let text = stdout(&out);
    assert!(text.contains("Pegasus v4.4.6"), "{text}");

    let row = |key: &str| -> Vec<String> {
        text.lines()
            .find(|l| l.starts_with(&format!("{key} ")))
            .unwrap_or_else(|| panic!("no row for {key} in:\n{text}"))
            .split_whitespace()
            .map(str::to_owned)
            .collect()
    };
    let planets = row("planets");
    let bytes: usize = planets[1].parse().unwrap();
    assert!(
        (5_400_000..=5_500_000).contains(&bytes),
        "planets bytes {bytes}"
    );
    assert_eq!(row("galactic_object")[3], "791");
}

#[test]
fn inspect_galaxy_summarises_systems_and_lanes() {
    let out = sgf(&["inspect", SAMPLE, "--galaxy"]);
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let text = stdout(&out);
    let line = |key: &str| -> String {
        text.lines()
            .find(|l| l.starts_with(key))
            .unwrap_or_else(|| {
                panic!(
                    "no {key} line in:
{text}"
                )
            })
            .to_owned()
    };
    assert!(line("systems:").contains("791"), "{text}");
    assert!(line("lanes:").contains("1092"), "{text}");
    assert!(line("lanes:").contains("125 bridge"), "{text}");
    assert!(line("lane-less:").contains("789, 790"), "{text}");
    assert!(line("nebulae:").contains('9'), "{text}");
    assert!(line("radius:").contains("499.9288"), "{text}");
}

#[test]
fn validate_reports_warnings_and_passes_a_vanilla_save() {
    // A game-written save must validate with exit 0. The sample carries the game's own
    // duplicate lane entries (154<->708, 401<->521) and two lane-less systems: warnings.
    let out = sgf(&["validate", SAMPLE]);
    assert_eq!(out.status.code(), Some(0), "{}", stdout(&out));
    let text = stdout(&out);
    assert!(
        text.contains("warning system_isolated: system 789"),
        "{text}"
    );
    assert!(
        text.contains("warning system_isolated: system 790"),
        "{text}"
    );
    assert!(
        text.contains("warning lane_duplicate: system 154"),
        "{text}"
    );
    assert!(
        text.contains("validate: 6 warning(s), 0 error(s), 0 note(s)"),
        "{text}"
    );
}

#[test]
fn validate_reports_a_scenarios_ranged_position() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("ranged.txt");
    std::fs::write(&path, RANGED_SCENARIO).unwrap();

    let out = sgf(&["validate", path.to_str().unwrap()]);
    let text = stdout(&out);
    assert_eq!(
        out.status.code(),
        Some(0),
        "{text}{}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert!(
        text.contains("warning position_range: system 0 position was a range"),
        "{text}"
    );
    assert!(!text.contains("position_range: system 1"), "{text}");
}

#[test]
fn inspect_and_roundtrip_refuse_a_scenario() {
    let dir = tempfile::tempdir().unwrap();
    let copy = dir.path().join("copy.txt");

    let out = sgf(&["inspect", SCENARIO]);
    assert_eq!(out.status.code(), Some(1), "{}", stdout(&out));
    assert!(
        stdout(&out).contains("inspect: ") && stdout(&out).contains("reads saves only"),
        "{}",
        stdout(&out)
    );

    let out = sgf(&["roundtrip", SCENARIO, copy.to_str().unwrap()]);
    assert_eq!(out.status.code(), Some(1), "{}", stdout(&out));
    assert!(
        stdout(&out).contains("roundtrip: ") && stdout(&out).contains("reads saves only"),
        "{}",
        stdout(&out)
    );
    assert!(!copy.exists());
}

#[test]
fn roundtrip_check_is_byte_identical_and_writes_nothing_twice() {
    let dir = tempfile::tempdir().unwrap();
    let out_path = dir.path().join("copy.sav");
    let out_str = out_path.to_str().unwrap();

    let out = sgf(&["roundtrip", SAMPLE, out_str, "--check"]);
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert!(
        stdout(&out).contains("roundtrip: byte-identical"),
        "{}",
        stdout(&out)
    );
    assert_eq!(backups(dir.path()).len(), 0);

    let out = sgf(&["roundtrip", SAMPLE, out_str, "--check"]);
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert!(
        stdout(&out).contains("roundtrip: byte-identical"),
        "{}",
        stdout(&out)
    );
    let backups = backups(dir.path());
    assert_eq!(
        backups.len(),
        0,
        "identical bytes make no backup: {backups:?}"
    );
    assert!(!stdout(&out).contains("backup "), "{}", stdout(&out));
}

#[test]
fn synth_writes_a_galaxy_that_inspects_and_validates() {
    let dir = tempfile::tempdir().unwrap();
    let sav = dir.path().join("synth.sav");
    let sav_str = sav.to_str().unwrap();
    let copy = dir.path().join("copy.sav");
    let copy_str = copy.to_str().unwrap();

    let out = sgf(&["synth", "--systems", "500", "-o", sav_str]);
    assert_eq!(
        out.status.code(),
        Some(0),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert!(stdout(&out).contains("500 systems"), "{}", stdout(&out));

    let out = sgf(&["inspect", sav_str, "--galaxy"]);
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let text = stdout(&out);
    let line = |key: &str| -> String {
        text.lines()
            .find(|l| l.starts_with(key))
            .unwrap_or_else(|| panic!("no {key} line in:\n{text}"))
            .to_owned()
    };
    assert!(line("systems:").contains("500"), "{text}");
    let lanes = line("lanes:");
    let count: usize = lanes
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or_else(|| panic!("no lane count in: {lanes}"));
    assert!(count > 0, "{lanes}");

    let out = sgf(&["validate", sav_str]);
    assert_eq!(out.status.code(), Some(0), "{}", stdout(&out));
    assert!(stdout(&out).contains(" 0 error(s)"), "{}", stdout(&out));

    let out = sgf(&["roundtrip", sav_str, copy_str, "--check"]);
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert!(
        stdout(&out).contains("roundtrip: byte-identical"),
        "{}",
        stdout(&out)
    );
}

#[test]
fn synth_writes_the_waystation_networks_it_is_given() {
    let dir = tempfile::tempdir().unwrap();
    let sav = dir.path().join("waystations.sav");
    let sav_str = sav.to_str().unwrap();

    let out = sgf(&[
        "synth",
        "--systems",
        "12",
        "--waystations",
        "3,7,9",
        "-o",
        sav_str,
    ]);
    assert_eq!(
        out.status.code(),
        Some(0),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert!(
        stdout(&out).contains("1 waystation network(s)"),
        "{}",
        stdout(&out)
    );

    let out = sgf(&["inspect", sav_str]);
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let text = stdout(&out);
    assert!(text.contains("waystation_networks"), "{text}");
    assert!(text.contains("starbase_mgr"), "{text}");

    let out = sgf(&["validate", sav_str]);
    assert_eq!(out.status.code(), Some(0), "{}", stdout(&out));
    assert!(stdout(&out).contains(" 0 error(s)"), "{}", stdout(&out));

    let copy = dir.path().join("copy.sav");
    let out = sgf(&["roundtrip", sav_str, copy.to_str().unwrap(), "--check"]);
    assert!(
        stdout(&out).contains("roundtrip: byte-identical"),
        "{}",
        stdout(&out)
    );
}

#[test]
fn synth_rejects_zero_systems() {
    let dir = tempfile::tempdir().unwrap();
    let out_path = dir.path().join("never.sav");
    let out = sgf(&["synth", "--systems", "0", "-o", out_path.to_str().unwrap()]);
    assert_eq!(out.status.code(), Some(1));
    let err = String::from_utf8_lossy(&out.stderr);
    assert!(err.starts_with("error: "), "{err}");
    assert!(!out_path.exists());
}

fn backups(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .filter(|n| n.contains(".bak-"))
        .collect();
    names.sort();
    names
}

#[test]
fn move_writes_the_edited_save_to_the_output_path() {
    let dir = tempfile::tempdir().unwrap();
    let out_path = dir.path().join("moved.sav");
    let out_str = out_path.to_str().unwrap();

    let out = sgf(&["move", SAMPLE, "0", "-150", "60", "-o", out_str]);
    assert_eq!(
        out.status.code(),
        Some(0),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let text = stdout(&out);
    assert!(
        text.contains("Moved Gamma Refuge (#0) from (-144.22, 57.36) to (-150, 60)"),
        "{text}"
    );
    assert!(
        text.contains("validate: 6 warning(s), 0 error(s), 0 note(s)"),
        "{text}"
    );
    assert!(text.contains(&format!("wrote {out_str}")), "{text}");
    assert!(out_path.is_file());
    assert_eq!(backups(dir.path()).len(), 0);
}

#[test]
fn nebula_add_remove_and_radius_write_the_edited_save() {
    let dir = tempfile::tempdir().unwrap();
    let added = dir.path().join("added.sav");
    let out = sgf(&[
        "nebula",
        "add",
        SAMPLE,
        "-57.5",
        "-305",
        "40",
        "--name",
        "SGF_Test_Nebula",
        "-o",
        added.to_str().unwrap(),
    ]);
    assert_eq!(
        out.status.code(),
        Some(0),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let text = stdout(&out);
    assert!(
        text.contains(
            "Added nebula \"SGF_Test_Nebula\" at (-57.5, -305) radius 40; 4 systems joined"
        ),
        "{text}"
    );
    assert!(added.is_file());

    let grown = dir.path().join("grown.sav");
    let out = sgf(&[
        "nebula",
        "radius",
        added.to_str().unwrap(),
        "9",
        "50",
        "-o",
        grown.to_str().unwrap(),
    ]);
    assert_eq!(
        out.status.code(),
        Some(0),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert!(
        stdout(&out).contains("radius to 50 (was 40)"),
        "{}",
        stdout(&out)
    );

    let removed = dir.path().join("removed.sav");
    let out = sgf(&[
        "nebula",
        "remove",
        grown.to_str().unwrap(),
        "9",
        "-o",
        removed.to_str().unwrap(),
    ]);
    assert_eq!(
        out.status.code(),
        Some(0),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert!(
        stdout(&out).contains("Removed nebula \"SGF Test Nebula\""),
        "{}",
        stdout(&out)
    );
    assert!(removed.is_file());
}

#[test]
fn nebula_name_renames_the_cloud_and_writes_the_edited_save() {
    let dir = tempfile::tempdir().unwrap();
    let renamed = dir.path().join("renamed.sav");
    let out = sgf(&[
        "nebula",
        "name",
        SAMPLE,
        "0",
        "Sea of Ghosts",
        "-o",
        renamed.to_str().unwrap(),
    ]);
    assert_eq!(
        out.status.code(),
        Some(0),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert!(
        stdout(&out)
            .contains("Renamed nebula 0 from \"Phantom_Streak_Miasma\" to \"Sea of Ghosts\""),
        "{}",
        stdout(&out)
    );
    assert!(renamed.is_file());

    let out = sgf(&[
        "nebula",
        "name",
        renamed.to_str().unwrap(),
        "0",
        "",
        "-o",
        dir.path().join("never.sav").to_str().unwrap(),
    ]);
    assert_eq!(out.status.code(), Some(1));
    let err = String::from_utf8_lossy(&out.stderr);
    assert!(err.contains("a name may not be empty"), "{err}");
    assert!(!dir.path().join("never.sav").exists());
}

#[test]
fn nebula_radius_of_an_unknown_index_fails_without_writing() {
    let dir = tempfile::tempdir().unwrap();
    let out_path = dir.path().join("never.sav");
    let out = sgf(&[
        "nebula",
        "radius",
        SAMPLE,
        "99",
        "30",
        "-o",
        out_path.to_str().unwrap(),
    ]);
    assert_eq!(out.status.code(), Some(1));
    let err = String::from_utf8_lossy(&out.stderr);
    assert!(err.contains("nebula 99 does not exist"), "{err}");
    assert!(!out_path.exists());
}

#[test]
fn lane_add_to_self_fails_without_writing() {
    let dir = tempfile::tempdir().unwrap();
    let out_path = dir.path().join("never.sav");
    let out = sgf(&[
        "lane",
        "add",
        SAMPLE,
        "0",
        "0",
        "-o",
        out_path.to_str().unwrap(),
    ]);
    assert_eq!(out.status.code(), Some(1));
    let err = String::from_utf8_lossy(&out.stderr);
    assert!(err.starts_with("error: "), "{err}");
    assert!(err.contains("itself"), "{err}");
    assert!(!out_path.exists());
}

#[test]
fn lane_normalise_writes_the_floor_of_the_distance() {
    let dir = tempfile::tempdir().unwrap();
    let out_path = dir.path().join("normalised.sav");
    let out_str = out_path.to_str().unwrap();

    let out = sgf(&["lane", "normalise", SAMPLE, "788", "760", "-o", out_str]);
    assert_eq!(
        out.status.code(),
        Some(0),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let text = stdout(&out);
    assert!(
        text.contains("Normalised lane 788 <-> 760 length from 20.70131 to 20"),
        "{text}"
    );
    assert!(out_path.is_file());
}

#[test]
fn lane_remove_of_a_missing_lane_fails() {
    let dir = tempfile::tempdir().unwrap();
    let out_path = dir.path().join("never.sav");
    let out = sgf(&[
        "lane",
        "remove",
        SAMPLE,
        "0",
        "1",
        "-o",
        out_path.to_str().unwrap(),
    ]);
    assert_eq!(out.status.code(), Some(1));
    let err = String::from_utf8_lossy(&out.stderr);
    assert!(err.starts_with("error: "), "{err}");
    assert!(err.contains("not linked"), "{err}");
    assert!(!out_path.exists());
}

#[test]
fn move_in_place_backs_up_the_original() {
    let dir = tempfile::tempdir().unwrap();
    let copy = dir.path().join("copy.sav");
    std::fs::copy(SAMPLE, &copy).unwrap();
    let copy_str = copy.to_str().unwrap();

    let out = sgf(&["move", copy_str, "0", "-150", "60"]);
    assert_eq!(
        out.status.code(),
        Some(0),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let text = stdout(&out);
    let backups = backups(dir.path());
    assert_eq!(backups.len(), 1, "{backups:?}");
    assert!(backups[0].starts_with("copy.sav.bak-"), "{backups:?}");
    assert!(text.contains(&format!("wrote {copy_str}")), "{text}");
    assert!(text.contains("backup "), "{text}");
    assert!(text.contains(&backups[0]), "{text}");
    assert_eq!(
        std::fs::read(dir.path().join(&backups[0])).unwrap(),
        std::fs::read(SAMPLE).unwrap(),
        "backup is not the original sample"
    );
    assert_ne!(
        std::fs::read(&copy).unwrap(),
        std::fs::read(SAMPLE).unwrap()
    );
}

#[test]
fn special_from_flags_alone_lists_systems_and_the_per_kind_footer() {
    let out = sgf(&["special", SAMPLE, "--no-gamedata"]);
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let text = stdout(&out);
    assert!(
        text.contains("special: 100 system(s) (save flags only)"),
        "{text}"
    );
    let footer = |kind: &str| -> Vec<String> {
        text.lines()
            .find(|l| l.trim_start().starts_with(&format!("{kind} ")))
            .unwrap_or_else(|| panic!("no footer row for {kind} in:\n{text}"))
            .split_whitespace()
            .map(str::to_owned)
            .collect()
    };
    assert_eq!(footer("leviathan")[1], "6");
    assert_eq!(footer("enclave")[1], "14");
    assert_eq!(footer("landmark")[1..], ["11", "11"]);
    assert!(
        text.lines().any(|l| l.starts_with('#')
            && l.contains("guardians_init_dragon")
            && l.contains("leviathan")),
        "{text}"
    );
}

#[test]
fn gamedata_with_a_bogus_install_fails_naming_the_searched_paths() {
    let dir = tempfile::tempdir().unwrap();
    let out = sgf(&["gamedata", "--install", dir.path().to_str().unwrap()]);
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert_eq!(out.status.code(), Some(1), "{stderr}");
    assert!(
        stderr.contains("no Stellaris install found; searched"),
        "{stderr}"
    );
    assert!(stderr.contains(dir.path().to_str().unwrap()), "{stderr}");
}

#[test]
fn export_scenario_writes_a_file_that_opens_as_the_saves_galaxy() {
    let dir = tempfile::tempdir().unwrap();
    let out_path = dir.path().join("exported.txt");
    let out_str = out_path.to_str().unwrap();
    let before = std::fs::metadata(SAMPLE).unwrap().len();

    let out = sgf(&["export-scenario", SAMPLE, out_str, "--name", "sgf_cli_test"]);
    assert_eq!(
        out.status.code(),
        Some(0),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let text = stdout(&out);
    assert!(
        text.contains("791 system(s), 1092 hyperlane(s), 9 nebula(e) as \"sgf_cli_test\""),
        "{text}"
    );
    assert!(text.contains(&format!("wrote {out_str}")), "{text}");
    assert!(text.contains("\nempire seats: 17\n"), "{text}");
    assert!(
        text.contains("\nhome initializers to review: une_deneb_system (system 4), shattered_ring_start (system 311), custom_starting_init_02 (system 786), custom_starting_init_02 (system 787)\n"),
        "{text}"
    );
    assert!(
        text.contains("\nnot carried over: 6 wormhole pairs\n"),
        "{text}"
    );
    assert!(!text.contains("\nneeds:"), "{text}");
    assert!(text.contains("\nhome: 17\n"), "{text}");
    assert!(text.ends_with("\ngeneric: 661\n"), "{text}");
    assert_eq!(std::fs::metadata(SAMPLE).unwrap().len(), before);
    assert_eq!(backups(dir.path()).len(), 0);

    let validated = sgf(&["validate", out_str]);
    assert_eq!(
        validated.status.code(),
        Some(0),
        "{}",
        String::from_utf8_lossy(&validated.stderr)
    );
    let written = std::fs::read_to_string(&out_path).unwrap();
    assert_eq!(
        written
            .lines()
            .filter(|l| l.starts_with("\tsystem = "))
            .count(),
        791,
        "{}",
        &written[..200]
    );
    assert_eq!(
        written.matches(" spawn_weight = { base = 1 }").count(),
        17,
        "{}",
        &written[..200]
    );
    assert!(
        written.starts_with("# Exported by Stellaris Galaxy Forge from 2206.11.16.sav\n"),
        "{}",
        &written[..200]
    );
}

#[test]
fn the_paint_a_galaxy_profile_is_opt_in_on_both_scenario_commands() {
    let dir = tempfile::tempdir().unwrap();
    let plain_path = dir.path().join("plain.txt");
    let paint_path = dir.path().join("paint.txt");
    let fresh_path = dir.path().join("fresh.txt");

    let out = sgf(&["export-scenario", SAMPLE, plain_path.to_str().unwrap()]);
    assert_eq!(
        out.status.code(),
        Some(0),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let plain = std::fs::read_to_string(&plain_path).unwrap();
    assert!(
        !plain.contains("value:painted_galaxy_spawn_weight"),
        "{}",
        &plain[..300]
    );
    assert!(!plain.contains("painted_galaxy_rl_basic"));
    assert!(
        plain.contains(
            "
static_galaxy_scenario = {
	name = \"2206.11.16\"
	priority = 5
"
        ),
        "{}",
        &plain[..300]
    );

    let out = sgf(&[
        "export-scenario",
        SAMPLE,
        paint_path.to_str().unwrap(),
        "--profile",
        "paint-a-galaxy",
    ]);
    assert_eq!(
        out.status.code(),
        Some(0),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let text = stdout(&out);
    assert!(text.contains("765 system(s)"), "{text}");
    assert!(!text.contains("empire seats"), "{text}");
    assert!(!text.contains("not carried over"), "{text}");
    assert!(
        text.contains("\nplayer seat: system 217 (preferred)\n"),
        "{text}"
    );
    assert!(
        text.contains("\nfallen empire PRESCRIPTED_species_adjective_tebrid: machine, 11 system(s) left out, anchor 791 at the old capital, linked to 6 system(s)\n"),
        "{text}"
    );
    assert!(
        text.contains("\nfallen empire SPEC_Ti-Zru Conservers: materialist, 5 system(s) left out, anchor 792 at the old capital, linked to 7 system(s)\n"),
        "{text}"
    );
    assert!(
        text.contains("\nfallen empire SPEC_Cyggan Protectors: spiritualist, 13 system(s) left out, anchor 793 at the old capital, linked to 12 system(s)\n"),
        "{text}"
    );
    assert!(
        text.contains("\nhome initializers replaced by a generic start: une_deneb_system (system 4), shattered_ring_start (system 311), custom_starting_init_02 (system 786), custom_starting_init_02 (system 787)\n"),
        "{text}"
    );
    assert!(
        text.contains("\nheader counts: from the save's setup\n"),
        "{text}"
    );
    assert!(!text.contains("\nleft out:"), "{text}");
    assert!(!text.contains("\nfallen empire zones: "), "{text}");
    let paint = std::fs::read_to_string(&paint_path).unwrap();
    assert!(
        paint.contains("value:painted_galaxy_spawn_weight"),
        "{}",
        &paint[..300]
    );
    assert!(paint.contains("set_star_flag = painted_galaxy_wormhole_1"));
    assert!(paint.contains("set_star_flag = painted_galaxy_fe_spawn_machine"));
    assert!(
        paint.starts_with(
            "# Exported by Stellaris Galaxy Forge from 2206.11.16.sav\n# Systems: 765 · Empire seats: 17 · Nebulae: 9\n# Written by Stellaris Galaxy Forge for the Paint a Galaxy mod"
        ),
        "{}",
        &paint[..300]
    );
    assert_eq!(
        paint,
        std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../testdata/2206.11.16.paint.txt"
        ))
        .unwrap(),
        "the fixture is generated: re-export it with `sgf export-scenario --profile paint-a-galaxy`"
    );
    let validated = sgf(&["validate", paint_path.to_str().unwrap()]);
    assert_eq!(
        validated.status.code(),
        Some(0),
        "{}",
        String::from_utf8_lossy(&validated.stderr)
    );

    let out = sgf(&[
        "new-scenario",
        "sgf_painted",
        fresh_path.to_str().unwrap(),
        "--profile",
        "paint-a-galaxy",
    ]);
    assert_eq!(
        out.status.code(),
        Some(0),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let fresh = std::fs::read_to_string(&fresh_path).unwrap();
    assert!(
        fresh.contains(
            "	priority = 10
	supports_shape = elliptical
	supports_shape = ring
"
        ),
        "{fresh}"
    );
    assert!(
        fresh.contains(
            "	nomad_empire_max = 0
"
        ),
        "{fresh}"
    );

    let out = sgf(&[
        "new-scenario",
        "sgf_odd",
        fresh_path.to_str().unwrap(),
        "--profile",
        "crayon",
    ]);
    assert_eq!(out.status.code(), Some(2));
    assert!(String::from_utf8_lossy(&out.stderr).contains("paint-a-galaxy"));
}

#[test]
fn new_scenario_writes_an_empty_scenario_that_opens() {
    let dir = tempfile::tempdir().unwrap();
    let out_path = dir.path().join("fresh.txt");
    let out_str = out_path.to_str().unwrap();

    let out = sgf(&["new-scenario", "sgf_fresh", out_str]);
    assert_eq!(
        out.status.code(),
        Some(0),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let text = stdout(&out);
    assert!(text.contains("new scenario \"sgf_fresh\""), "{text}");

    let written = std::fs::read_to_string(&out_path).unwrap();
    assert!(written.contains("name = \"sgf_fresh\""), "{written}");
    assert!(!written.contains("system = "), "{written}");

    let validated = sgf(&["validate", out_str]);
    assert_eq!(
        validated.status.code(),
        Some(0),
        "{}",
        String::from_utf8_lossy(&validated.stderr)
    );
}
