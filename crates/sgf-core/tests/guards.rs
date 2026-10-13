//! Rules of the codebase that a test holds rather than a reviewer: kind checks stay in the
//! format seam, every op is named with a verb from the engineering rules, and test files stay
//! under a size a reviewer can read. Each allowlist names the batch that clears its line.

use std::path::{Path, PathBuf};

use sgf_core::ops::Op;
use strum::VariantNames;

fn repo() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// Every file under `dir` whose name ends with one of `extensions`, as a path from the
/// repository root with forward slashes, skipping `node_modules`, `generated` and `target`.
fn files(dir: &str, extensions: &[&str]) -> Vec<String> {
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
                if !matches!(name, "node_modules" | "generated" | "target") {
                    pending.push(path);
                }
            } else if extensions.iter().any(|ext| name.ends_with(ext)) {
                let relative = path.strip_prefix(repo()).expect("under the repository");
                found.push(relative.to_string_lossy().replace('\\', "/"));
            }
        }
    }
    found.sort();
    found
}

fn read(file: &str) -> String {
    std::fs::read_to_string(repo().join(file)).unwrap_or_else(|e| panic!("{file}: {e}"))
}

/// Whether `word` stands in `line` as a whole identifier.
fn has_word(line: &str, word: &str) -> bool {
    let ident = |c: char| c.is_alphanumeric() || c == '_';
    line.match_indices(word)
        .any(|(at, _)| !line[..at].ends_with(ident) && !line[at + word.len()..].starts_with(ident))
}

/// Where a kind check belongs: where a document's kind is read and the format chosen by it.
const KIND_SEAM: &[&str] = &[
    "crates/sgf-core/src/document.rs",
    "crates/sgf-core/src/format/mod.rs",
];

/// Today's kind checks, each with the batch that turns it into a capability read.
const KIND_OFFENDERS: &[(&str, &str)] = &[
    ("crates/sgf-core/src/export/mod.rs", "2h"),
    ("crates/sgf-core/src/format/save/write/copy_bodies.rs", "2b"),
    ("crates/sgf-core/src/format/save/write/move_planet.rs", "2b"),
    ("crates/sgf-core/src/search/star_types.rs", "2b"),
    ("crates/sgf-core/src/session/edit.rs", "2b"),
    ("crates/sgf-core/src/session/game_data.rs", "2b"),
    ("crates/sgf-core/src/session/report.rs", "2b"),
    ("crates/sgf-core/src/validate/mod.rs", "2b"),
    ("crates/sgf-cli/src/commands/mod.rs", "3b"),
    ("crates/sgf-cli/src/commands/prepare.rs", "2h"),
    ("app/src-tauri/src/commands/add_body.rs", "3b"),
    ("app/src-tauri/src/commands/add_habitat.rs", "3b"),
    ("app/src-tauri/src/commands/add_megastructure.rs", "3b"),
    ("app/src-tauri/src/commands/add_ring_world.rs", "3b"),
    ("app/src-tauri/src/commands/add_system.rs", "3b"),
    ("app/src-tauri/src/commands/gamedata.rs", "3b"),
    ("app/src-tauri/src/commands/mod.rs", "3b"),
    ("app/src-tauri/src/commands/prepare.rs", "3b"),
    ("app/src-tauri/src/commands/scenario.rs", "3b"),
    ("app/src-tauri/src/commands/session.rs", "3b"),
];

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

fn asks_the_kind(file: &str, line: &str) -> bool {
    let names_a_kind = ["DocumentKind::Save", "DocumentKind::Scenario"]
        .iter()
        .any(|kind| line.contains(kind));
    let branches = ["==", "!=", "matches!"].iter().any(|op| line.contains(op))
        || [
            "DocumentKind::Save =>",
            "DocumentKind::Scenario =>",
            "DocumentKind::Save |",
            "DocumentKind::Scenario |",
        ]
        .iter()
        .any(|arm| line.contains(arm));
    // Gamedata's diagnostics have a `kind()` of their own.
    let compares_kinds = !file.starts_with("crates/sgf-gamedata/")
        && (line.contains("kind() ==") || line.contains("kind() !="))
        && !line.contains("ErrorKind");
    (names_a_kind && branches)
        || compares_kinds
        || has_word(line, "is_save")
        || has_word(line, "is_scenario")
}

#[test]
fn production_code_asks_capabilities_not_the_document_kind() {
    let mut unlisted = Vec::new();
    let mut found = Vec::new();
    for dir in ["crates", "app/src-tauri/src"] {
        for file in files(dir, &[".rs"]) {
            if file.contains("/tests/") || KIND_SEAM.contains(&file.as_str()) {
                continue;
            }
            let source = read(&file);
            for (i, line) in production(&source).lines().enumerate() {
                if line.trim_start().starts_with("//") || !asks_the_kind(&file, line) {
                    continue;
                }
                found.push(file.clone());
                if !KIND_OFFENDERS.iter().any(|(listed, _)| *listed == file) {
                    unlisted.push(format!("{file}:{}: {}", i + 1, line.trim()));
                }
            }
        }
    }
    let cleared: Vec<_> = KIND_OFFENDERS
        .iter()
        .filter(|(listed, _)| !found.iter().any(|file| file == listed))
        .map(|(listed, _)| listed)
        .collect();
    assert!(
        unlisted.is_empty(),
        "Ask the document's capabilities, not its kind (ADR 0004). These lines compare a kind:\n{}",
        unlisted.join("\n")
    );
    assert!(
        cleared.is_empty(),
        "These files no longer compare a kind; delete their KIND_OFFENDERS line: {cleared:?}"
    );
}

/// The backticked words of the "- Verbs." bullet in `docs/engineering-rules.md`.
fn op_verbs() -> Vec<String> {
    let rules = read("docs/engineering-rules.md");
    let bullet: String = rules
        .lines()
        .skip_while(|line| !line.starts_with("- Verbs."))
        .enumerate()
        .take_while(|(i, line)| *i == 0 || line.starts_with("  "))
        .map(|(_, line)| format!("{line} "))
        .collect();
    let verbs: Vec<String> = bullet
        .split('`')
        .skip(1)
        .step_by(2)
        .map(str::to_owned)
        .collect();
    assert!(
        !verbs.is_empty(),
        "docs/engineering-rules.md has no \"- Verbs.\" bullet"
    );
    verbs
}

#[test]
fn every_op_is_named_with_a_verb_from_the_engineering_rules() {
    let verbs = op_verbs();
    let unnamed: Vec<_> = Op::VARIANTS
        .iter()
        .filter(|&&name| name != "Batch")
        .filter(|name| {
            !verbs.iter().any(|verb| {
                name.strip_prefix(verb)
                    .is_some_and(|subject| subject.starts_with(char::is_uppercase))
            })
        })
        .collect();
    assert!(
        unnamed.is_empty(),
        "crates/sgf-core/src/ops/op.rs: an op is a verb and a subject, and the verb is one of \
         {verbs:?} (docs/engineering-rules.md, \"Naming ops\"). These are not: {unnamed:?}"
    );
}

const TEST_FILE_LINES: usize = 700;

/// Today's test files over the ceiling, each with the batch that splits it.
const LONG_TEST_FILES: &[(&str, &str)] = &[
    (
        "app/src/panels/inspector/entity/BodyPage.pools.test.tsx",
        "5f",
    ),
    ("app/src/lib/megastructurePicks.test.ts", "3e"),
    (
        "app/src/panels/overlays/AddMegastructureDialog.test.tsx",
        "3e",
    ),
    (
        "app/src/panels/overlays/ContextMenu.systemView.test.tsx",
        "5a",
    ),
    ("app/src/test/builders.ts", "stays: the shared builders"),
];

fn is_test_file(file: &str) -> bool {
    let name = file.rsplit('/').next().unwrap_or(file);
    if file.ends_with(".rs") {
        return file.contains("/tests/");
    }
    file.starts_with("app/src/test/")
        || file.contains("/__mocks__/")
        || name.contains(".test.")
        || name.to_lowercase().contains("fixture")
}

#[test]
fn no_test_file_is_over_700_lines() {
    let mut long = Vec::new();
    for (dir, extensions) in [
        ("crates", &[".rs"][..]),
        ("app/src-tauri/tests", &[".rs"][..]),
        ("app/src", &[".ts", ".tsx"][..]),
    ] {
        for file in files(dir, extensions) {
            if !is_test_file(&file) {
                continue;
            }
            let lines = read(&file).lines().count();
            if lines > TEST_FILE_LINES {
                long.push((file, lines));
            }
        }
    }
    let unlisted: Vec<_> = long
        .iter()
        .filter(|(file, _)| !LONG_TEST_FILES.iter().any(|(listed, _)| listed == file))
        .map(|(file, lines)| format!("{file} ({lines} lines)"))
        .collect();
    let split: Vec<_> = LONG_TEST_FILES
        .iter()
        .filter(|(listed, _)| !long.iter().any(|(file, _)| file == listed))
        .map(|(listed, _)| listed)
        .collect();
    assert!(
        unlisted.is_empty(),
        "A test file is at most {TEST_FILE_LINES} lines; split these by what they test: {unlisted:?}"
    );
    assert!(
        split.is_empty(),
        "These test files are under {TEST_FILE_LINES} lines now; delete their LONG_TEST_FILES line: {split:?}"
    );
}
