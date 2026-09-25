//! `sgf add-system`, from specs and generated.
use std::path::Path;

use crate::common::{DORELLION, MURA, SAMPLE_4_5, fixture, ok, sgf, stdout, without_install};

#[test]
fn add_system_writes_the_spec_and_the_new_system_reads_back() {
    let dir = tempfile::tempdir().unwrap();
    let out_path = dir.path().join("added.sav");
    let out_str = out_path.to_str().unwrap();

    let out = sgf(&["add-system", SAMPLE_4_5, "--spec", MURA, "-o", out_str]);
    ok(&out);
    let text = stdout(&out);
    assert!(
        text.contains("Added Mura (#601) at (-292.23404, -137.62265) with 9 bodies and 1 lane"),
        "{text}"
    );
    assert!(text.contains(&format!("wrote {out_str}")), "{text}");

    let details = sgf(&["details", out_str, "601"]);
    assert_eq!(details.status.code(), Some(0), "{}", stdout(&details));
    assert!(
        stdout(&details).contains("planets: 9"),
        "{}",
        stdout(&details)
    );
    assert_eq!(sgf(&["validate", out_str]).status.code(), Some(0));
}

#[test]
fn add_system_refuses_a_3_x_save_without_writing() {
    let dir = tempfile::tempdir().unwrap();
    let out_path = dir.path().join("added.sav");
    let old = concat!(env!("CARGO_MANIFEST_DIR"), "/../../testdata/3.4.sav");
    let out = sgf(&[
        "add-system",
        old,
        "--spec",
        DORELLION,
        "-o",
        out_path.to_str().unwrap(),
    ]);
    assert_eq!(out.status.code(), Some(1));
    assert!(
        String::from_utf8_lossy(&out.stderr).contains("Stellaris 4.0 or later"),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert!(!out_path.exists());
}

/// `--then-remove` reaches the app's bulk delete: it removes the systems among its ids the
/// command added, as one step, and leaves the file's own alone.
#[test]
fn add_system_then_remove_removes_only_the_systems_it_added() {
    let dir = tempfile::tempdir().unwrap();
    let out_path = dir.path().join("removed.sav");
    let out_str = out_path.to_str().unwrap();
    let (tau_ceti, fellix) = (fixture("tau_ceti"), fixture("fellix"));
    let out = sgf(&[
        "add-system",
        SAMPLE_4_5,
        "--spec",
        MURA,
        "--spec",
        &tau_ceti,
        "--spec",
        &fellix,
        "--then-remove",
        "602",
        "--then-remove",
        "0",
        "-o",
        out_str,
    ]);
    ok(&out);
    let text = stdout(&out);
    assert!(
        text.contains("Removed Tau Ceti (#602) and 3 lanes; renumbered 603 to 602"),
        "{text}"
    );
    assert!(
        !text.contains("(#0)"),
        "the file's own system stays: {text}"
    );
    assert!(text.contains(&format!("wrote {out_str}")), "{text}");

    let never = dir.path().join("never.sav");
    let refused = sgf(&[
        "add-system",
        SAMPLE_4_5,
        "--spec",
        MURA,
        "--then-remove",
        "0",
        "-o",
        never.to_str().unwrap(),
    ]);
    assert_eq!(refused.status.code(), Some(1));
    let err = String::from_utf8_lossy(&refused.stderr);
    assert!(
        err.contains("none of the systems --then-remove names"),
        "{err}"
    );
    assert!(!never.exists());
}

#[test]
fn add_system_generates_a_system_from_a_seed_and_writes_it() {
    let dir = tempfile::tempdir().unwrap();
    let printed_path = dir.path().join("printed.sav");
    let out_path = dir.path().join("generated.sav");
    let out_str = out_path.to_str().unwrap();
    let args = |out: &Path, extra: &[&str]| -> Vec<String> {
        let mut args: Vec<String> = [
            "add-system",
            SAMPLE_4_5,
            "--generate",
            "--seed",
            "11",
            "--at",
            "-292.23404,-137.62265",
            "--lane",
            "169",
        ]
        .iter()
        .chain(extra)
        .map(|arg| (*arg).to_owned())
        .collect();
        args.extend(["-o".to_owned(), out.to_str().unwrap().to_owned()]);
        args
    };
    let run = |args: Vec<String>| sgf(&args.iter().map(String::as_str).collect::<Vec<_>>());

    let printed = run(args(&printed_path, &["--print-spec"]));
    if without_install(&printed) {
        return;
    }
    ok(&printed);
    assert!(!printed_path.exists(), "--print-spec writes nothing");
    let spec: serde_json::Value =
        serde_json::from_str(&stdout(&printed)).expect("the spec as JSON");
    assert_eq!(spec["lanes"], serde_json::json!([169]));
    assert_eq!(spec["x"], serde_json::json!(-292.23404));
    let name = spec["name"]
        .as_str()
        .expect("a name from the pool")
        .to_owned();
    assert!(!name.is_empty());
    assert_eq!(
        stdout(&run(args(&printed_path, &["--print-spec"]))),
        stdout(&printed),
        "the same seed"
    );

    let out = run(args(&out_path, &[]));
    ok(&out);
    let text = stdout(&out);
    assert!(text.contains(&format!("seed 11: {name} ")), "{text}");
    assert!(text.contains(&format!("Added {name} (#601)")), "{text}");
    assert_eq!(sgf(&["validate", out_str]).status.code(), Some(0));
}

/// A copy of the 4.5 sample in `dir` whose galaxy was set up at `abundance`.
fn sample_at_abundance(dir: &Path, abundance: &str) -> std::path::PathBuf {
    let raw = sgf_core::archive::read_sav(SAMPLE_4_5).expect("read the 4.5 sample");
    let text = String::from_utf8(raw.gamestate).expect("utf-8");
    let written = "\tresource_abundance=2\n";
    assert_eq!(text.matches(written).count(), 1, "the sample's setting");
    let text = text.replace(written, &format!("\tresource_abundance={abundance}\n"));
    let path = dir.join(format!("abundance_{abundance}.sav"));
    sgf_core::archive::write_sav(&path, std::iter::once(text.as_bytes()), &raw.meta)
        .expect("write the copy");
    path
}

/// Every body's deposits in a printed spec: the star, then each planet and its moons.
fn spec_deposits(spec: &serde_json::Value) -> Vec<(String, Vec<serde_json::Value>)> {
    let deposits = |body: &serde_json::Value| {
        let class = body["class"].as_str().unwrap_or_default().to_owned();
        let keys = body["deposits"].as_array().cloned().unwrap_or_default();
        (class, keys)
    };
    let mut out = vec![deposits(&spec["star"])];
    for planet in spec["planets"].as_array().expect("planets") {
        out.push(deposits(planet));
        let moons = planet["moons"].as_array().map_or(&[][..], Vec::as_slice);
        out.extend(moons.iter().map(deposits));
    }
    out
}

#[test]
fn add_system_rolls_deposits_at_the_abundance_the_save_was_set_up_with() {
    let dir = tempfile::tempdir().unwrap();
    let run = |sav: &Path, extra: &[&str]| {
        let out_path = dir.path().join("generated.sav");
        let mut args = vec![
            "add-system",
            sav.to_str().unwrap(),
            "--generate",
            "--seed",
            "55",
            "--at",
            "-313.94,-124.34",
            "--lane",
            "169",
        ];
        args.extend_from_slice(extra);
        args.extend_from_slice(&["-o", out_path.to_str().unwrap()]);
        sgf(&args)
    };
    let spec_at = |abundance: &str| {
        let printed = run(
            &sample_at_abundance(dir.path(), abundance),
            &["--print-spec"],
        );
        ok(&printed);
        let spec: serde_json::Value =
            serde_json::from_str(&stdout(&printed)).expect("the spec as JSON");
        spec_deposits(&spec)
    };
    let probe = run(Path::new(SAMPLE_4_5), &["--print-spec"]);
    if without_install(&probe) {
        return;
    }

    let none = spec_at("0");
    assert!(none.len() > 1);
    assert!(none.iter().all(|(_, keys)| keys.is_empty()), "{none:?}");
    let most = spec_at("5");
    assert_eq!(
        most.iter().map(|(class, _)| class).collect::<Vec<_>>(),
        none.iter().map(|(class, _)| class).collect::<Vec<_>>(),
        "the same bodies"
    );
    assert!(most.iter().all(|(_, keys)| !keys.is_empty()), "{most:?}");

    let out = run(&sample_at_abundance(dir.path(), "0"), &[]);
    ok(&out);
    assert!(!stdout(&out).contains(" deposits "), "{}", stdout(&out));

    let out = run(Path::new(SAMPLE_4_5), &[]);
    ok(&out);
    let text = stdout(&out);
    assert!(text.contains(" deposits "), "the sample's 2x: {text}");
    let written = dir.path().join("generated.sav");
    let details = stdout(&sgf(&["details", written.to_str().unwrap(), "601"]));
    let resources = details
        .lines()
        .find_map(|line| line.strip_prefix("resources: "))
        .expect("the resources line");
    assert_ne!(resources, "none", "{details}");
}

#[test]
fn add_system_takes_specs_or_a_generate_with_its_seed_and_place() {
    let dir = tempfile::tempdir().unwrap();
    let out_path = dir.path().join("refused.sav");
    let out = out_path.to_str().unwrap();
    let spec = MURA;
    for args in [
        &["--spec", spec, "--generate", "--seed", "1", "--at", "0,0"][..],
        &["--generate", "--at", "0,0"],
        &["--generate", "--seed", "1"],
        &["--spec", spec, "--seed", "1"],
        &["--spec", spec, "--lane", "169"],
        &["--spec", spec, "--star-class", "sc_g"],
        &[
            "--generate",
            "--seed",
            "1",
            "--at",
            "0,0",
            "--print-spec",
            "--then-remove",
            "601",
        ],
        &[
            "--generate",
            "--seed",
            "1",
            "--at",
            "0,0",
            "--print-spec",
            "--then-reroll",
            "2",
        ],
        &["--spec", spec, "--then-reroll", "2"],
        &["--generate", "--seed", "1", "--at", "0,0", "--keep-special"],
    ] {
        let mut command = vec!["add-system", SAMPLE_4_5];
        command.extend_from_slice(args);
        command.extend_from_slice(&["-o", out]);
        let refused = sgf(&command);
        assert_eq!(refused.status.code(), Some(2), "a usage error: {args:?}");
        assert!(!out_path.exists(), "{args:?}");
    }
}

#[test]
fn add_system_generates_around_the_star_class_asked_for() {
    let dir = tempfile::tempdir().unwrap();
    let out_path = dir.path().join("classed.sav");
    let out_str = out_path.to_str().unwrap();
    let run = |class: &str, extra: &[&str]| {
        let mut args = vec![
            "add-system",
            SAMPLE_4_5,
            "--generate",
            "--seed",
            "11",
            "--at",
            "-292.23404,-137.62265",
            "--lane",
            "169",
            "--star-class",
            class,
        ];
        args.extend_from_slice(extra);
        args.extend_from_slice(&["-o", out_str]);
        sgf(&args)
    };
    let printed = run("sc_m", &["--print-spec"]);
    if without_install(&printed) {
        return;
    }
    ok(&printed);
    let spec: serde_json::Value =
        serde_json::from_str(&stdout(&printed)).expect("the spec as JSON");
    assert_eq!(spec["star_class"], serde_json::json!("sc_m"));
    assert_eq!(spec["star"]["class"], serde_json::json!("pc_m_star"));
    assert_eq!(
        stdout(&run("sc_m", &["--print-spec"])),
        stdout(&printed),
        "the same seed and class"
    );

    let refused = run("sc_binary_1", &[]);
    assert_ne!(refused.status.code(), Some(0));
    assert!(
        String::from_utf8_lossy(&refused.stderr).contains("sc_binary_1"),
        "{}",
        String::from_utf8_lossy(&refused.stderr)
    );
    assert!(!out_path.exists());

    let out = run("sc_m", &[]);
    ok(&out);
    assert!(stdout(&out).contains(" sc_m ("), "{}", stdout(&out));
    assert_eq!(sgf(&["validate", out_str]).status.code(), Some(0));
}

#[test]
fn add_system_generates_the_special_layout_asked_for() {
    let dir = tempfile::tempdir().unwrap();
    let out_path = dir.path().join("trappist.sav");
    let out_str = out_path.to_str().unwrap();
    let run = |layout: &str, extra: &[&str]| {
        let mut args = vec![
            "add-system",
            SAMPLE_4_5,
            "--generate",
            "--seed",
            "4",
            "--at",
            "-292.23404,-137.62265",
            "--lane",
            "169",
            "--layout",
            layout,
        ];
        args.extend_from_slice(extra);
        args.extend_from_slice(&["-o", out_str]);
        sgf(&args)
    };
    let out = run("trappist_initializer", &[]);
    if without_install(&out) {
        return;
    }
    ok(&out);
    let text = stdout(&out);
    assert!(
        text.contains("NAME_Trappist sc_m (trappist_initializer, capped)"),
        "{text}"
    );
    assert!(text.contains("(named after the system)"), "{text}");
    assert!(text.contains("modifiers terraforming_candidate"), "{text}");
    assert_eq!(sgf(&["validate", out_str]).status.code(), Some(0));

    let again = sgf(&[
        "add-system",
        out_str,
        "--generate",
        "--seed",
        "4",
        "--at",
        "-250,-160",
        "--layout",
        "trappist_initializer",
        "--print-spec",
    ]);
    let spec: serde_json::Value = serde_json::from_str(&stdout(&again)).expect("the spec");
    assert_ne!(
        spec["name"],
        serde_json::json!("NAME_Trappist"),
        "a system already holds the fixed name"
    );

    let refused = run("great_wound_system", &["--print-spec"]);
    assert_ne!(refused.status.code(), Some(0));
    let err = String::from_utf8_lossy(&refused.stderr);
    assert!(
        err.contains("great_wound_system cannot be generated"),
        "{err}"
    );
}

/// `--then-reroll` reaches the app's reroll: the system keeps its name and position, and
/// with `--keep-special` a Special menu layout is built from that layout again.
#[test]
fn add_system_then_reroll_keeps_the_name_and_with_keep_special_the_layout() {
    let dir = tempfile::tempdir().unwrap();
    let out_path = dir.path().join("rerolled.sav");
    let out_str = out_path.to_str().unwrap();
    let run = |extra: &[&str]| {
        let mut args = vec![
            "add-system",
            SAMPLE_4_5,
            "--generate",
            "--seed",
            "5",
            "--at",
            "-292.23404,-137.62265",
            "--layout",
            "wenkwort_initializer",
        ];
        args.extend_from_slice(extra);
        args.extend_from_slice(&["-o", out_str]);
        sgf(&args)
    };
    let kept = run(&["--then-reroll", "6", "--keep-special"]);
    if without_install(&kept) {
        return;
    }
    ok(&kept);
    let text = stdout(&kept);
    let rolls: Vec<&str> = text.lines().filter(|l| l.starts_with("seed ")).collect();
    let [added, again] = rolls[..] else {
        panic!("one line per roll: {text}");
    };
    let name = |line: &str| {
        let (_, rest) = line.split_once(": ").expect("seed N: name class (layout)");
        let head = rest.split(" (").next().unwrap_or_default();
        head.rsplit_once(' ')
            .map_or(head, |(name, _)| name)
            .to_owned()
    };
    assert!(added.starts_with("seed 5: "), "{text}");
    assert!(again.starts_with("seed 6: "), "{text}");
    assert_eq!(name(again), name(added), "the name stays: {text}");
    assert!(again.contains("(wenkwort_initializer"), "{text}");
    ok(&sgf(&["validate", out_str]));

    let changed = run(&["--then-reroll", "6"]);
    ok(&changed);
    let text = stdout(&changed);
    let again = text
        .lines()
        .find(|l| l.starts_with("seed 6: "))
        .expect("the second roll");
    assert!(
        !again.contains("(wenkwort_initializer"),
        "a random roll: {text}"
    );
}
