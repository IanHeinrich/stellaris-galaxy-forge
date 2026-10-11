//! Which editors the shell finds, on fake folder trees laid out as each platform installs them,
//! and the program and arguments each is started with. Nothing is started.

use std::collections::HashMap;
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};

use serde_json::json;
use sgf_app_lib::editors::{self, EditorPick, Places, Platform};
use sgf_core::views::ErrorKind;
use tauri::WebviewWindow;
use tauri::test::MockRuntime;

use crate::common::{self, SAMPLE, invoke, kind, webview};

/// Empty files at each of `rels` below `root`, as the programs an install leaves.
fn programs(root: &Path, rels: &[&str]) {
    for rel in rels {
        let file = root.join(rel);
        fs::create_dir_all(file.parent().expect("a folder")).expect("the tree");
        fs::write(file, b"").expect("a program");
    }
}

fn ids(platform: Platform, places: &Places) -> Vec<String> {
    editors::detect(platform, places)
        .into_iter()
        .map(|editor| editor.view.id)
        .collect()
}

fn args(list: &[&str]) -> Vec<OsString> {
    list.iter().map(OsString::from).collect()
}

/// VS Code through the script its installer puts on `PATH`, VSCodium in the user's programs,
/// Notepad++ from the registry, Sublime Text in Program Files, IntelliJ IDEA from the Toolbox
/// app, two versions of PyCharm from their installer and Kate on `PATH`: listed in the order
/// modders use them, each opening the file at its line in its own way.
#[test]
fn the_editors_a_windows_machine_has_are_found_and_open_a_file_at_its_line() {
    let dir = tempfile::tempdir().expect("temp dir");
    let root = dir.path();
    programs(
        root,
        &[
            "vscode/bin/code.cmd",
            "vscode/Code.exe",
            "local/Programs/VSCodium/VSCodium.exe",
            "npp/notepad++.exe",
            "pf/Sublime Text/subl.exe",
            "local/Programs/IntelliJ IDEA Community Edition/bin/idea64.exe",
            "pf86/JetBrains/PyCharm 2024.1/bin/pycharm64.exe",
            "pf86/JetBrains/PyCharm 2025.2/bin/pycharm64.exe",
            "kate/bin/kate.exe",
        ],
    );
    let places = Places {
        path: vec![root.join("vscode/bin"), root.join("kate/bin")],
        local_app_data: Some(root.join("local")),
        program_files: vec![root.join("pf"), root.join("pf86")],
        applications: Vec::new(),
        app_paths: HashMap::from([("notepad++.exe".to_owned(), root.join("npp/notepad++.exe"))]),
    };
    let found = editors::detect(Platform::Windows, &places);
    let listed: Vec<(&str, &str)> = found
        .iter()
        .map(|e| (e.view.id.as_str(), e.view.name.as_str()))
        .collect();
    assert_eq!(
        listed,
        [
            ("vscode", "VS Code"),
            ("vscodium", "VSCodium"),
            ("notepad_plus_plus", "Notepad++"),
            ("sublime_text", "Sublime Text"),
            ("intellij_idea", "IntelliJ IDEA"),
            ("pycharm", "PyCharm"),
            ("kate", "Kate"),
        ]
    );
    let program = |id: &str| -> PathBuf {
        found
            .iter()
            .find(|e| e.view.id == id)
            .map(|e| e.program.clone())
            .expect("found")
    };
    assert_eq!(
        program("vscode"),
        root.join("vscode/Code.exe"),
        "the program the script starts, so no command interpreter runs"
    );
    assert_eq!(
        program("pycharm"),
        root.join("pf86/JetBrains/PyCharm 2025.2/bin/pycharm64.exe"),
        "the newest of two versions"
    );

    let file = Path::new(r"C:\Program Files (x86)\Steam\steamapps\common\Stellaris\common\x.txt");
    let quoted = r#"C:\Users\o'Neil "x"\mod\a b.txt"#;
    let launched = |id: &str, file: &Path, line: Option<u32>| {
        let editor = found.iter().find(|e| e.view.id == id).expect("found");
        editor.launch(file, line).args
    };
    let at = format!("{}:42", file.display());
    let path = file.display().to_string();
    assert_eq!(launched("vscode", file, Some(42)), args(&["-g", &at]));
    assert_eq!(launched("vscodium", file, Some(42)), args(&["-g", &at]));
    assert_eq!(
        launched("notepad_plus_plus", file, Some(42)),
        args(&["-n42", &path])
    );
    assert_eq!(launched("sublime_text", file, Some(42)), args(&[&at]));
    assert_eq!(
        launched("intellij_idea", file, Some(42)),
        args(&["--line", "42", &path])
    );
    assert_eq!(launched("kate", file, Some(42)), args(&["-l", "42", &path]));
    assert_eq!(
        launched("notepad_plus_plus", Path::new(quoted), None),
        args(&[quoted]),
        "without a line, the file alone, as one argument whatever it holds"
    );
}

#[test]
fn the_editors_a_mac_has_are_found_in_its_applications_folders_and_on_its_path() {
    let dir = tempfile::tempdir().expect("temp dir");
    let root = dir.path();
    programs(
        root,
        &[
            "Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
            "home/Applications/PyCharm CE.app/Contents/MacOS/pycharm",
            "bin/subl",
        ],
    );
    let places = Places {
        path: vec![root.join("bin")],
        applications: vec![root.join("Applications"), root.join("home/Applications")],
        ..Places::default()
    };
    assert_eq!(
        ids(Platform::MacOs, &places),
        ["vscode", "sublime_text", "pycharm"]
    );
}

#[test]
fn the_editors_a_linux_machine_has_are_found_on_its_path() {
    let dir = tempfile::tempdir().expect("temp dir");
    let root = dir.path();
    programs(
        root,
        &["bin/codium", "bin/idea.sh", "bin/kate", "bin/notepad++.exe"],
    );
    let places = Places {
        path: vec![root.join("bin")],
        ..Places::default()
    };
    assert_eq!(
        ids(Platform::Linux, &places),
        ["vscodium", "intellij_idea", "kate"],
        "Notepad++ is not looked for outside Windows"
    );
}

#[test]
fn a_program_the_user_names_takes_its_arguments_with_the_file_and_line_put_in() {
    let file = Path::new("/mods/my mod/common/x.txt");
    let other = |program: &str, pattern: &str, line: Option<u32>| {
        let pick = EditorPick::Other {
            program: program.to_owned(),
            args: pattern.to_owned(),
        };
        editors::launch_for(&pick, &[], file, line).expect("a launch")
    };
    let launch = other(
        r#""C:\Tools\ed.exe""#,
        r#"--goto "{file}:{line}" -w"#,
        Some(7),
    );
    assert_eq!(launch.program, PathBuf::from(r"C:\Tools\ed.exe"));
    assert_eq!(
        launch.args,
        args(&["--goto", "/mods/my mod/common/x.txt:7", "-w"])
    );
    assert_eq!(
        other("ed", "+{line}", None).args,
        args(&["+1", "/mods/my mod/common/x.txt"]),
        "the file goes last when the pattern does not place it, at line 1 without a line"
    );
    assert_eq!(
        editors::launch_for(&EditorPick::SystemDefault, &[], file, Some(7)),
        None
    );
    assert_eq!(
        editors::launch_for(
            &EditorPick::Found {
                id: "vscode".to_owned()
            },
            &[],
            file,
            Some(7)
        ),
        None,
        "an editor no longer found falls to the system default"
    );
}

#[test]
fn steam_replaces_the_games_files_and_workshop_downloads_but_not_a_local_mod() {
    let dir = tempfile::tempdir().expect("temp dir");
    let install = dir.path().join("steamapps/common/Stellaris");
    programs(&install, &["common/x.txt"]);
    let replaces = |file: PathBuf| editors::steam_replaces(&file, Some(&install));
    assert!(replaces(install.join("common/x.txt")));
    assert!(replaces(PathBuf::from(
        r"D:\Steam\steamapps\workshop\content\281990\123\common\x.txt"
    )));
    assert!(!replaces(PathBuf::from(
        r"C:\Users\me\Documents\Paradox Interactive\Stellaris\mod\mine\common\x.txt"
    )));
}

/// The open commands refuse a file that is neither game data nor the open scenario before any
/// program is looked for.
#[test]
fn a_file_outside_the_game_data_and_the_open_scenario_is_not_opened_in_an_editor() {
    let w = webview();
    let open = |w: &WebviewWindow<MockRuntime>| {
        invoke::<()>(
            w,
            "open_in_editor",
            json!({ "path": SAMPLE, "line": 3, "editor": { "kind": "system_default" } }),
        )
    };
    assert_eq!(
        kind(open(&w)),
        ErrorKind::Op,
        "no game data, no script index"
    );
    let Some((w, _)) = common::with_game_data(SAMPLE) else {
        return;
    };
    assert_eq!(
        kind(open(&w)),
        ErrorKind::NotFound,
        "a save is not a file the app opens"
    );
}
