//! `sgf shape`: every key path of a save with its count, or with `--diff` the paths a
//! save adds to and drops from another; a difference is information, never a failure.

use std::collections::BTreeMap;
use std::path::Path;

use sgf_core::archive;
use sgf_core::shape::{self, ShapeDiff};

use super::{Outcome, Run, saves_only};

type Paths = BTreeMap<String, usize>;

pub fn run(sav: &Path, diff: Option<&Path>, sections: &[String]) -> Run {
    for path in [Some(sav), diff].into_iter().flatten() {
        if let Some(outcome) = saves_only("shape", path) {
            return Ok(outcome);
        }
    }
    let paths = key_paths(sav, sections)?;
    match diff {
        None => print_paths(&paths),
        Some(other) => print_diff(&shape::diff(&key_paths(other, sections)?, &paths)),
    }
    Ok(Outcome::Ok)
}

/// The save's key paths, kept to `sections` when any are named.
fn key_paths(sav: &Path, sections: &[String]) -> Result<Paths, Box<dyn std::error::Error>> {
    let gamestate = archive::read_sav(sav)?.gamestate;
    let mut paths = shape::key_paths(&gamestate)?;
    if !sections.is_empty() {
        paths.retain(|path, _| sections.iter().any(|s| s == shape::section_of(path)));
    }
    Ok(paths)
}

fn print_paths(paths: &Paths) {
    let mut section = None;
    for (path, count) in paths {
        let this = shape::section_of(path);
        if section.is_some_and(|s| s != this) {
            println!();
        }
        section = Some(this);
        println!("{count:>9} {path}");
    }
}

fn print_diff(diff: &ShapeDiff) {
    let mut sections: Vec<&str> = diff
        .removed
        .iter()
        .chain(&diff.added)
        .map(|p| shape::section_of(p))
        .collect();
    sections.sort_unstable();
    sections.dedup();
    for section in &sections {
        println!("{section}");
        for path in diff
            .removed
            .iter()
            .filter(|p| shape::section_of(p) == *section)
        {
            println!("- {path}");
        }
        for path in diff
            .added
            .iter()
            .filter(|p| shape::section_of(p) == *section)
        {
            println!("+ {path}");
        }
        println!();
    }
    match sections.len() {
        1 => println!("1 section differs"),
        n => println!("{n} sections differ"),
    }
}
