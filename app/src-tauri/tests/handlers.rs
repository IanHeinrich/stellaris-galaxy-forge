//! Every `#[tauri::command]` under `src/commands/` is registered in `generate_handler!`, and
//! every name `app/src/api/*.ts` invokes is one of them, so a command that is written and never
//! listed, or a wrapper that names a command that does not exist, fails here and not in the
//! running app.
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

fn src() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("src")
}

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

/// The commands `generate_handler!` in `lib.rs` registers.
fn registered() -> BTreeSet<String> {
    let lib = std::fs::read_to_string(src().join("lib.rs")).expect("lib.rs reads");
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
    registered
}

/// The command names `source` passes to `invoke`, each a string literal. A call whose first
/// argument is anything else panics naming `file`.
fn invoked_names(file: &str, source: &str) -> Vec<String> {
    let mut names = Vec::new();
    for after in source.split("invoke").skip(1) {
        let rest = after.trim_start();
        let rest = match rest.strip_prefix('<') {
            Some(generic) => {
                let mut depth = 1;
                let end = generic
                    .char_indices()
                    .find(|&(_, c)| {
                        depth += match c {
                            '<' => 1,
                            '>' => -1,
                            _ => 0,
                        };
                        depth == 0
                    })
                    .map(|(i, _)| i + 1)
                    .unwrap_or_else(|| panic!("{file}: an `invoke<` generic never closes"));
                generic[end..].trim_start()
            }
            None => rest,
        };
        let Some(call) = rest.strip_prefix('(') else {
            continue;
        };
        let name = call
            .trim_start()
            .strip_prefix('"')
            .and_then(|quoted| quoted.split('"').next())
            .unwrap_or_else(|| panic!("{file}: `invoke` is called without a literal command name"));
        names.push(name.to_owned());
    }
    names
}

#[test]
fn every_command_is_registered_in_the_handler() {
    let mut written = BTreeSet::new();
    for entry in std::fs::read_dir(src().join("commands")).expect("the commands directory reads") {
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

    let registered = registered();
    let unregistered: Vec<_> = written.difference(&registered).collect();
    let unwritten: Vec<_> = registered.difference(&written).collect();
    assert!(
        unregistered.is_empty() && unwritten.is_empty(),
        "commands missing from generate_handler!: {unregistered:?}; registered but not a command: {unwritten:?}"
    );
}

#[test]
fn every_ipc_name_the_app_invokes_is_a_registered_command_and_every_command_is_invoked() {
    let api = src().join("../../src/api");
    let mut invoked = BTreeMap::new();
    for entry in std::fs::read_dir(&api).expect("app/src/api reads") {
        let path = entry.expect("directory entry reads").path();
        let file = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if !file.ends_with(".ts") || file.ends_with(".test.ts") {
            continue;
        }
        let file = format!("app/src/api/{file}");
        let source = std::fs::read_to_string(&path).expect("an api file reads");
        for name in invoked_names(&file, &source) {
            invoked.insert(name, file.clone());
        }
    }
    assert!(invoked.len() > 50, "only {} names invoked", invoked.len());

    let registered = registered();
    let unknown: Vec<_> = invoked
        .iter()
        .filter(|(name, _)| !registered.contains(*name))
        .map(|(name, file)| format!("{file} invokes {name}"))
        .collect();
    let uncalled: Vec<_> = registered
        .iter()
        .filter(|name| !invoked.contains_key(*name))
        .collect();
    assert!(
        unknown.is_empty() && uncalled.is_empty(),
        "every IPC name must match a command in generate_handler!. Not registered: {unknown:?}; \
         registered but never invoked from app/src/api: {uncalled:?}"
    );
}
