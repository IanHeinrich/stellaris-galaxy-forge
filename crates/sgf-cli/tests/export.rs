//! `sgf export-scenario` and `sgf new-scenario`.
use crate::common::{SAMPLE, backups, ok, sgf, stdout};

#[test]
fn export_scenario_writes_a_file_that_opens_as_the_saves_galaxy() {
    let dir = tempfile::tempdir().unwrap();
    let out_path = dir.path().join("exported.txt");
    let out_str = out_path.to_str().unwrap();
    let before = std::fs::metadata(SAMPLE).unwrap().len();

    let out = sgf(&["export-scenario", SAMPLE, out_str, "--name", "sgf_cli_test"]);
    ok(&out);
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
    ok(&validated);
    let written = std::fs::read_to_string(&out_path).unwrap();
    assert_eq!(
        written.matches(" spawn_weight = { base = 1 }").count(),
        17,
        "{}",
        &written[..200]
    );
    assert!(
        written.starts_with(&format!(
            "#\u{200B} created by Stellaris Galaxy Forge {} (converted from save 2206.11.16.sav)\n",
            env!("CARGO_PKG_VERSION")
        )),
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
    ok(&out);
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
	name = \"plain\"
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
        "--name",
        "2206.11.16",
        "--profile",
        "paint-a-galaxy",
    ]);
    ok(&out);
    let text = stdout(&out);
    assert!(text.contains("765 system(s)"), "{text}");
    assert!(!text.contains("empire seats"), "{text}");
    assert!(!text.contains("not carried over"), "{text}");
    assert!(
        text.contains(
            "\nplayer seat: system 217 (Sol seat, certain for the United Nations of Earth)\n"
        ),
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
    let paint = paint.replacen(
        concat!("Stellaris Galaxy Forge ", env!("CARGO_PKG_VERSION"), " "),
        "Stellaris Galaxy Forge 0.0.0 ",
        1,
    );
    assert!(
        paint.starts_with(
            "#\u{200B} created by Stellaris Galaxy Forge 0.0.0 (converted from save 2206.11.16.sav)\n# Systems: 765 · Empire seats: 17 · Nebulae: 9\n# Written by Stellaris Galaxy Forge for the Paint a Galaxy mod"
        ),
        "{}",
        &paint[..300]
    );
    let validated = sgf(&["validate", paint_path.to_str().unwrap()]);
    ok(&validated);

    let out = sgf(&[
        "new-scenario",
        "sgf_painted",
        fresh_path.to_str().unwrap(),
        "--profile",
        "paint-a-galaxy",
    ]);
    ok(&out);
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
    ok(&out);
    let text = stdout(&out);
    assert!(text.contains("new scenario \"sgf_fresh\""), "{text}");

    let written = std::fs::read_to_string(&out_path).unwrap();
    assert!(written.contains("name = \"sgf_fresh\""), "{written}");
    assert!(!written.contains("system = "), "{written}");

    let validated = sgf(&["validate", out_str]);
    ok(&validated);
}
