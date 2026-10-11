//! Which editors the shell finds, on fake folder trees laid out as each platform installs them,
//! and the program and arguments each is started with. Nothing is started.

use std::collections::HashMap;
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};

use serde_json::{Value, json};
use sgf_app_lib::editors::{self, EditorPick, PickedProgramFile, Places, Platform};
use sgf_app_lib::state::GameDataState;
use sgf_core::views::{ErrorKind, SgfError};
use tauri::test::MockRuntime;
use tauri::{Manager, WebviewWindow};

use crate::common::{self, SAMPLE, SCENARIO, invoke, kind, open, webview};

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
fn the_picked_program_takes_its_arguments_with_the_file_and_line_put_in() {
    let file = Path::new("/mods/my mod/common/x.txt");
    let program = Path::new(r"C:\Tools\ed.exe");
    let other = |pattern: &str, picked: Option<&Path>, line: Option<u32>| {
        let pick = EditorPick::Other {
            args: pattern.to_owned(),
        };
        editors::launch_for(&pick, &[], picked, file, line)
    };
    let launch = other(r#"--goto "{file}:{line}" -w"#, Some(program), Some(7)).expect("a launch");
    assert_eq!(launch.program, program);
    assert_eq!(
        launch.args,
        args(&["--goto", "/mods/my mod/common/x.txt:7", "-w"])
    );
    assert!(
        !launch.no_console,
        "a program the user picked may need its console"
    );
    assert_eq!(
        other("+{line}", Some(program), None)
            .expect("a launch")
            .args,
        args(&["+1", "/mods/my mod/common/x.txt"]),
        "the file goes last when the pattern does not place it, at line 1 without a line"
    );
    assert_eq!(other("{file}", None, Some(7)), None, "no program picked");
    assert_eq!(
        editors::launch_for(&EditorPick::SystemDefault, &[], None, file, Some(7)),
        None
    );
    assert_eq!(
        editors::launch_for(
            &EditorPick::Found {
                id: "vscode".to_owned()
            },
            &[],
            None,
            file,
            Some(7)
        ),
        None,
        "an editor no longer found falls to the system default"
    );
}

/// A Mac app picked for Other… is a folder, which `open -a` starts with the arguments after
/// `--args`.
#[test]
fn a_picked_mac_app_is_started_through_open() {
    let dir = tempfile::tempdir().expect("temp dir");
    let app = dir.path().join("Zed.app");
    fs::create_dir_all(app.join("Contents/MacOS")).expect("the bundle");
    let pick = EditorPick::Other {
        args: "{file}:{line}".to_owned(),
    };
    let file = Path::new("/mods/my mod/common/x.txt");
    let launch = editors::launch_for(&pick, &[], Some(&app), file, Some(7)).expect("a launch");
    assert_eq!(launch.program, Path::new("open"));
    let mut expected = args(&["-a"]);
    expected.push(app.clone().into_os_string());
    expected.extend(args(&["--args", "/mods/my mod/common/x.txt:7"]));
    assert_eq!(launch.args, expected);
}

#[test]
fn the_picked_program_is_kept_in_a_file_and_named_for_its_file() {
    let dir = tempfile::tempdir().expect("temp dir");
    let store = dir.path().join("config/editor.json");
    assert_eq!(editors::picked_program(&store), None);
    let program = dir.path().join("Tools/my editor.exe");
    editors::keep_program(&store, &program).expect("kept");
    assert_eq!(editors::picked_program(&store), Some(program.clone()));
    assert_eq!(editors::program_name(&program), "my editor.exe");
    fs::write(&store, "not json").expect("written");
    assert_eq!(
        editors::picked_program(&store),
        None,
        "an unreadable file is no pick"
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

fn opened(w: &WebviewWindow<MockRuntime>, command: &str, path: &str) -> Result<Value, SgfError> {
    let args = match command {
        "open_script" => json!({ "path": path, "reveal": false }),
        _ => json!({ "path": path, "line": 3, "editor": { "kind": "system_default" } }),
    };
    invoke::<Value>(w, command, args)
}

/// Both open commands refuse a file that is not a script text file of the game data or the open
/// scenario, before anything is handed to the system: a save, a program, a script or a
/// shortcut would be run or unpacked.
#[test]
fn a_program_a_shortcut_or_a_save_is_not_opened() {
    let w = webview();
    for command in ["open_script", "open_in_editor"] {
        for path in [
            SAMPLE,
            "C:/Steam/steamapps/common/Stellaris/stellaris.exe",
            "C:/Users/me/Documents/mod/mine/run.bat",
            "C:/Users/me/Documents/mod/mine/Stellaris.lnk",
            "C:/Users/me/Documents/mod/mine/page.url",
        ] {
            assert_eq!(
                kind(opened(&w, command, path)),
                ErrorKind::NotFound,
                "{command} {path}"
            );
        }
        assert_eq!(
            kind(opened(&w, command, SCENARIO)),
            ErrorKind::Op,
            "{command}: a script file, but no game data to hold it and no scenario open"
        );
    }
    let Some(w) = common::game_data_webview() else {
        return;
    };
    let gd = w
        .app_handle()
        .state::<GameDataState>()
        .loaded()
        .expect("game data");
    let exe = gd.layout.install.join("stellaris.exe");
    for command in ["open_script", "open_in_editor"] {
        assert_eq!(
            kind(opened(&w, command, &exe.display().to_string())),
            ErrorKind::NotFound,
            "{command}: the game's own program"
        );
    }
}

/// Other… opens files only with the program picked in the shell's own file dialog: before one
/// is picked, it is refused rather than left to the system default.
#[test]
fn other_is_refused_until_a_program_is_picked() {
    let dir = tempfile::tempdir().expect("temp dir");
    let w = webview();
    w.app_handle()
        .state::<PickedProgramFile>()
        .point_at(dir.path().join("editor.json"));
    open(&w, SCENARIO);
    let refused = invoke::<Value>(
        &w,
        "open_in_editor",
        json!({ "path": SCENARIO, "line": 3, "editor": { "kind": "other", "args": "{file}" } }),
    )
    .expect_err("no program picked");
    assert_eq!(refused.kind, ErrorKind::NotFound);
    assert_eq!(refused.message, "Choose a program for Other… first");
}
