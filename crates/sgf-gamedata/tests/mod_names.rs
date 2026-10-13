//! Mod content is detected by what its data does, and only `mod_compatibility/` may name a
//! mod: a string literal holding a known mod's prefix or a Workshop id anywhere else in
//! production code fails here.

use std::path::{Path, PathBuf};

use sgf_gamedata::mod_compatibility::MOD_PREFIXES;

/// The files outside `mod_compatibility/` that may name a mod, each with why.
const MOD_NAME_SEAMS: &[(&str, &str)] = &[(
    "crates/sgf-core/src/format/scenario/paint.rs",
    "the Paint a Galaxy scenario names the mod it needs, and sgf-core cannot read sgf-gamedata",
)];

fn repo() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// Every production source file under `dir`, as a path from the repository root with forward
/// slashes: not a test, a test builder, generated code or `mod_compatibility/`.
fn production_files(dir: &str) -> Vec<String> {
    let mut found = Vec::new();
    let mut pending = vec![repo().join(dir)];
    while let Some(dir) = pending.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries {
            let path = entry.expect("a directory entry").path();
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if path.is_dir() {
                let skipped = [
                    "node_modules",
                    "generated",
                    "target",
                    "tests",
                    "test",
                    "__mocks__",
                    "mod_compatibility",
                ];
                if !skipped.contains(&name) {
                    pending.push(path);
                }
            } else if [".rs", ".ts", ".tsx"].iter().any(|ext| name.ends_with(ext))
                && !name.contains(".test.")
                && !name.to_lowercase().contains("fixture")
            {
                let relative = path.strip_prefix(repo()).expect("under the repository");
                found.push(relative.to_string_lossy().replace('\\', "/"));
            }
        }
    }
    found.sort();
    found
}

/// The string literals on `line`, between double quotes, or also single quotes and backticks
/// in TypeScript.
fn literals(line: &str, typescript: bool) -> Vec<&str> {
    let quotes: &[char] = if typescript {
        &['"', '\'', '`']
    } else {
        &['"']
    };
    let mut found = Vec::new();
    let mut open: Option<(char, usize)> = None;
    let mut escaped = false;
    for (at, c) in line.char_indices() {
        match open {
            Some(_) if escaped => escaped = false,
            Some(_) if c == '\\' => escaped = true,
            Some((quote, start)) if c == quote => {
                found.push(&line[start..at]);
                open = None;
            }
            Some(_) => {}
            None if line[at..].starts_with("//") => break,
            None if quotes.contains(&c) => open = Some((c, at + 1)),
            None => {}
        }
    }
    found
}

/// `source` up to its inline `#[cfg(test)] mod tests`, if it has one.
fn production(source: &str) -> &str {
    let end = source
        .match_indices("#[cfg(test)]")
        .find(|(at, attr)| {
            source[at + attr.len()..]
                .trim_start()
                .starts_with("mod tests")
        })
        .map_or(source.len(), |(at, _)| at);
    &source[..end]
}

/// The null id is ten digits too.
const NULL_ID: &str = "4294967295";

fn names_a_mod(literal: &str) -> bool {
    let workshop_id = literal
        .split(|c: char| !c.is_ascii_digit())
        .any(|run| (9..=10).contains(&run.len()) && run != NULL_ID);
    let prefixed = MOD_PREFIXES.iter().any(|prefix| {
        literal
            .match_indices(prefix)
            .any(|(at, _)| !literal[..at].ends_with(|c: char| c.is_alphanumeric()))
    });
    workshop_id || prefixed
}

#[test]
fn only_mod_compatibility_names_a_mod() {
    let mut unlisted = Vec::new();
    let mut found = Vec::new();
    for dir in ["crates", "app/src-tauri/src", "app/src"] {
        for file in production_files(dir) {
            let source = std::fs::read_to_string(repo().join(&file)).expect("a source file reads");
            let typescript = !file.ends_with(".rs");
            for (i, line) in production(&source).lines().enumerate() {
                let Some(literal) = literals(line, typescript)
                    .into_iter()
                    .find(|literal| names_a_mod(literal))
                else {
                    continue;
                };
                found.push(file.clone());
                if !MOD_NAME_SEAMS.iter().any(|(listed, _)| *listed == file) {
                    unlisted.push(format!("{file}:{}: \"{literal}\"", i + 1));
                }
            }
        }
    }
    let cleared: Vec<_> = MOD_NAME_SEAMS
        .iter()
        .filter(|(listed, _)| !found.iter().any(|file| file == listed))
        .map(|(listed, _)| listed)
        .collect();
    assert!(
        unlisted.is_empty(),
        "Detect mod content by its data; only mod_compatibility/ names a mod. These literals name one:\n{}",
        unlisted.join("\n")
    );
    assert!(
        cleared.is_empty(),
        "These files no longer name a mod; delete their MOD_NAME_SEAMS line: {cleared:?}"
    );
}
