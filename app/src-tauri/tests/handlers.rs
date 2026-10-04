//! Every `#[tauri::command]` under `src/commands/` is registered in `generate_handler!`, so a
//! command that is written and never listed fails here and not in the running app.
use std::collections::BTreeSet;
use std::path::Path;

/// The names of the functions a `#[tauri::command]` attribute sits on in `source`.
fn command_names(source: &str) -> Vec<String> {
    let mut names = Vec::new();
    let mut pending = false;
    for line in source.lines() {
        let line = line.trim();
        if line.starts_with("#[tauri::command") {
            pending = true;
        } else if pending && line.contains("fn ") {
            let after = line.split("fn ").nth(1).expect("a name follows `fn`");
            let end = after
                .find(|c: char| !(c.is_alphanumeric() || c == '_'))
                .unwrap_or(after.len());
            names.push(after[..end].to_owned());
            pending = false;
        }
    }
    names
}

#[test]
fn every_command_is_registered_in_the_handler() {
    let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut written = BTreeSet::new();
    for entry in std::fs::read_dir(src.join("commands")).expect("the commands directory reads") {
        let path = entry.expect("directory entry reads").path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("rs") {
            continue;
        }
        let source = std::fs::read_to_string(&path).expect("a command file reads");
        for name in command_names(&source) {
            assert!(
                written.insert(name.clone()),
                "{name} is a command in two files"
            );
        }
    }
    assert!(written.len() > 50, "only {} commands found", written.len());

    let lib = std::fs::read_to_string(src.join("lib.rs")).expect("lib.rs reads");
    let list = lib
        .split("generate_handler![")
        .nth(1)
        .and_then(|rest| rest.split(']').next())
        .expect("lib.rs lists the handlers");
    let mut registered = BTreeSet::new();
    for entry in list.split(',').map(str::trim).filter(|e| !e.is_empty()) {
        let name = entry
            .strip_prefix("commands::")
            .unwrap_or_else(|| panic!("`{entry}` is not a `commands::` path"));
        assert!(
            registered.insert(name.to_owned()),
            "{name} is registered twice"
        );
    }

    let unregistered: Vec<_> = written.difference(&registered).collect();
    let unwritten: Vec<_> = registered.difference(&written).collect();
    assert!(
        unregistered.is_empty() && unwritten.is_empty(),
        "commands missing from generate_handler!: {unregistered:?}; registered but not a command: {unwritten:?}"
    );
}
