//! What a load reports of its progress: every step of `meter::STEPS` in order and a bar that
//! moves steadily, and with `SGF_PLAYSET=1` the time each step takes on the real install.

use std::time::Instant;

use sgf_gamedata::meter::STEPS;
use sgf_gamedata::{GameData, LoadOptions, Meter, Reading};

use crate::common;

fn load(opts: &LoadOptions) -> (GameData, Vec<(Reading, Instant)>) {
    let mut readings = Vec::new();
    let mut report = |reading| readings.push((reading, Instant::now()));
    let gd = sgf_gamedata::load(opts, Meter::new(&mut report)).expect("the install loads");
    (gd, readings)
}

/// The fixture install with a mod of twenty files in each folder a heavy step reads part by
/// part, so each of those steps has parts to report.
#[test]
fn a_load_reports_every_step_in_order_and_moves_steadily() {
    let user_dir = tempfile::tempdir().expect("a user dir");
    let mut files = Vec::new();
    let mut megastructures = String::new();
    for i in 0..20 {
        for dir in ["events", "common/scripted_effects", "common/decisions"] {
            files.push((format!("{dir}/busy_{i}.txt"), String::new()));
        }
        files.push((format!("gfx/models/busy_{i}.dds"), String::new()));
        files.push((
            format!("localisation/english/busy_{i}_l_english.yml"),
            format!("l_english:\n busy_{i}:0 \"Busy {i}\"\n"),
        ));
        megastructures.push_str(&format!("busy_{i} = {{ entity = \"\" }}\n"));
    }
    files.push(("common/megastructures/busy.txt".to_owned(), megastructures));
    let files: Vec<(&str, &str)> = files
        .iter()
        .map(|(rel, text)| (rel.as_str(), text.as_str()))
        .collect();
    common::playset(user_dir.path(), &[("busy", &files)]);
    let opts = LoadOptions {
        install: Some(common::fixture("install")),
        user_dir: Some(user_dir.path().to_path_buf()),
        language: "english".to_owned(),
        mods: true,
    };
    let (_, readings) = load(&opts);
    let fractions: Vec<f64> = readings.iter().map(|(r, _)| r.fraction).collect();

    let mut steps: Vec<&str> = readings.iter().map(|(r, _)| r.step).collect();
    steps.dedup();
    let table: Vec<&str> = STEPS.iter().map(|(step, ..)| *step).collect();
    assert_eq!(steps, table);
    assert!(fractions[0] <= 0.05, "{fractions:?}");
    assert!(fractions[fractions.len() - 1] >= 0.95, "{fractions:?}");
    for pair in fractions.windows(2) {
        assert!(pair[0] <= pair[1], "{fractions:?}");
        assert!(pair[1] - pair[0] <= 0.15, "{fractions:?}");
    }
}

/// Prints how long each step of a load takes, with the enabled mods and without, to set
/// the weights in `meter::STEPS` from.
#[test]
fn load_time_by_step() {
    if std::env::var_os("SGF_PLAYSET").is_none_or(|v| v != "1") {
        eprintln!("skipped: SGF_PLAYSET=1 times a load of the enabled mods");
        return;
    }
    for mods in [true, false] {
        let (gd, readings) = load(&LoadOptions {
            mods,
            ..LoadOptions::default()
        });
        let mut starts: Vec<(&str, Instant)> = Vec::new();
        for (reading, at) in &readings {
            if starts.last().is_none_or(|(step, _)| *step != reading.step) {
                starts.push((reading.step, *at));
            }
        }
        let end = readings.last().expect("a reading").1;
        let total = end - starts[0].1;
        println!(
            "\n{} mods enabled, {} ms in all",
            gd.mods.len(),
            total.as_millis()
        );
        let weights: u32 = STEPS.iter().map(|(.., weight)| weight).sum();
        println!("{:<20} {:>8} {:>7} {:>7}", "step", "ms", "share", "bar");
        for (i, (step, start)) in starts.iter().enumerate() {
            let next = starts.get(i + 1).map_or(end, |(_, at)| *at);
            let took = next - *start;
            let weight = STEPS.iter().find(|(s, ..)| s == step).map_or(0, |s| s.2);
            println!(
                "{step:<20} {:>8} {:>6.1}% {:>6.1}%",
                took.as_millis(),
                100.0 * took.as_secs_f64() / total.as_secs_f64(),
                100.0 * f64::from(weight) / f64::from(weights)
            );
        }
        let mut waits: Vec<_> = readings
            .windows(2)
            .map(|pair| (pair[1].1 - pair[0].1, pair[0].0))
            .collect();
        waits.sort_by_key(|(wait, _)| std::cmp::Reverse(*wait));
        println!("{} readings; the longest waits:", readings.len());
        for (wait, at) in waits.iter().take(3) {
            println!(
                "  {} ms after {} at {:.1}%",
                wait.as_millis(),
                at.step,
                100.0 * at.fraction
            );
        }
    }
}
