//! The text editors a modder opens script files in: which of them this machine has, and the
//! program and arguments that open a file at a line in each. Nothing here goes through a
//! shell: a program is started with its arguments as a list.

use std::collections::HashMap;
use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// An editor found on this machine, as the chooser lists it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct EditorView {
    /// The same on every run, so a remembered choice can name it.
    pub id: String,
    /// `VS Code`, `Notepad++`.
    pub name: String,
}

/// The program a file is opened with.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub enum EditorPick {
    /// An editor found on this machine, by its id.
    Found { id: String },
    /// Whatever the system opens the file with.
    SystemDefault,
    /// The program the user picked in the shell's file dialog, with these arguments, where
    /// `{file}` is the file and `{line}` the line.
    Other { args: String },
}

/// What the chooser offers for one file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct EditorChoices {
    /// The editors found, in the order modders use them most.
    pub editors: Vec<EditorView>,
    /// The name of the program picked for Other…; `None` until one is picked.
    pub other: Option<String>,
    /// The file is the game's own or a Workshop mod's, which Steam replaces when it updates.
    pub steam_replaces: bool,
}

/// How a file was opened.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct OpenedFile {
    /// The editor asked for could not be started, so the system default opened the file.
    pub fell_back: bool,
    /// The file is the game's own or a Workshop mod's, which Steam replaces when it updates.
    pub steam_replaces: bool,
}

/// The extensions of the text files the app opens: those the game-data reader reads, and the
/// interface and name-list files beside them. None of them runs when the system opens it.
const SCRIPT_EXTENSIONS: [&str; 6] = ["txt", "yml", "gfx", "asset", "gui", "csv"];

/// `file` is a script text file, by its extension.
pub fn is_script_text(file: &Path) -> bool {
    file.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| {
            SCRIPT_EXTENSIONS
                .iter()
                .any(|known| ext.eq_ignore_ascii_case(known))
        })
}

/// The operating system whose places and program names detection uses.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Platform {
    Windows,
    MacOs,
    Linux,
}

impl Platform {
    pub fn current() -> Self {
        if cfg!(windows) {
            Self::Windows
        } else if cfg!(target_os = "macos") {
            Self::MacOs
        } else {
            Self::Linux
        }
    }
}

/// The folders detection looks in, read from the environment, so a test can point them at a
/// tree of its own.
#[derive(Debug, Clone, Default)]
pub struct Places {
    /// The folders of `PATH`, in order.
    pub path: Vec<PathBuf>,
    /// `%LOCALAPPDATA%`.
    pub local_app_data: Option<PathBuf>,
    /// `%ProgramFiles%` and `%ProgramFiles(x86)%`.
    pub program_files: Vec<PathBuf>,
    /// `/Applications` and the user's own `Applications`.
    pub applications: Vec<PathBuf>,
    /// The registry's App Paths entries, by program name.
    pub app_paths: HashMap<String, PathBuf>,
}

/// The program names the registry's App Paths are read for.
const APP_PATHS: [&str; 1] = ["notepad++.exe"];

impl Places {
    /// This machine's.
    pub fn here(platform: Platform) -> Self {
        let var = |name: &str| std::env::var_os(name).map(PathBuf::from);
        let path = std::env::var_os("PATH")
            .map(|p| std::env::split_paths(&p).collect())
            .unwrap_or_default();
        match platform {
            Platform::Windows => Self {
                path,
                local_app_data: var("LOCALAPPDATA"),
                program_files: ["ProgramFiles", "ProgramFiles(x86)"]
                    .into_iter()
                    .filter_map(var)
                    .collect(),
                applications: Vec::new(),
                app_paths: APP_PATHS
                    .into_iter()
                    .filter_map(|name| Some((name.to_owned(), app_path(name)?)))
                    .collect(),
            },
            Platform::MacOs => Self {
                path,
                applications: std::iter::once(PathBuf::from("/Applications"))
                    .chain(var("HOME").map(|home| home.join("Applications")))
                    .collect(),
                ..Self::default()
            },
            Platform::Linux => Self {
                path,
                ..Self::default()
            },
        }
    }
}

/// The program `name`'s App Paths entry, exported by `reg.exe` to a file: an export is written
/// in UTF-16, where `reg query` prints in the console's code page and garbles a path outside it.
fn app_path(name: &str) -> Option<PathBuf> {
    let key = format!(r"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\{name}");
    let export = std::env::temp_dir().join(format!("sgf-app-path-{}.reg", std::process::id()));
    let mut command = Command::new("reg");
    command.arg("export").arg(&key).arg(&export).arg("/y");
    no_console(&mut command);
    let exported = command.output().is_ok_and(|out| out.status.success());
    let bytes = std::fs::read(&export).ok();
    let _ = std::fs::remove_file(&export);
    default_value(&utf16(&bytes.filter(|_| exported)?)).map(PathBuf::from)
}

fn utf16(bytes: &[u8]) -> String {
    let units: Vec<u16> = bytes
        .as_chunks::<2>()
        .0
        .iter()
        .map(|pair| u16::from_le_bytes(*pair))
        .collect();
    String::from_utf16_lossy(&units)
}

/// The key's default value in a `.reg` export: the `@="…"` line, its backslashes unescaped.
fn default_value(export: &str) -> Option<String> {
    let line = export
        .lines()
        .find_map(|line| line.trim().strip_prefix("@="))?;
    let value = line.strip_prefix('"')?.strip_suffix('"')?;
    let value = value.replace(r"\\", r"\").replace(r#"\""#, "\"");
    (!value.is_empty()).then_some(value)
}

#[cfg(windows)]
fn no_console(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn no_console(_: &mut Command) {}

/// How an editor is told the line to open a file at.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LineArgs {
    /// `-g <file>:<line>`.
    Goto,
    /// `-n<line> <file>`.
    AttachedN,
    /// `<file>:<line>`.
    Suffix,
    /// `--line <line> <file>`.
    LongLine,
    /// `-l <line> <file>`.
    ShortL,
}

/// One place an editor's program can be. In a folder path, a `*` part matches any one folder
/// and a `*.app` part any app bundle.
#[derive(Debug, Clone, Copy)]
enum Spot {
    /// A program of this name in a folder of `PATH`.
    OnPath(&'static str),
    /// A script of the first name in a folder of `PATH`, and the program of the second name in
    /// the folder above, which the script starts.
    ScriptOnPath(&'static str, &'static str),
    /// Below `%LOCALAPPDATA%`.
    LocalAppData(&'static str),
    /// Below `%ProgramFiles%` or `%ProgramFiles(x86)%`.
    ProgramFiles(&'static str),
    /// Below an `Applications` folder.
    Applications(&'static str),
    /// The registry's App Paths entry of this program name.
    AppPath(&'static str),
}

/// An editor modders use, and where each platform puts it.
struct Known {
    id: &'static str,
    name: &'static str,
    args: LineArgs,
    windows: &'static [Spot],
    mac: &'static [Spot],
    linux: &'static [Spot],
}

impl Known {
    fn spots(&self, platform: Platform) -> &'static [Spot] {
        match platform {
            Platform::Windows => self.windows,
            Platform::MacOs => self.mac,
            Platform::Linux => self.linux,
        }
    }
}

/// A JetBrains IDE whose launcher is `$launcher`: `<launcher>64.exe` on Windows, from its
/// installer or from the Toolbox app, and `<launcher>` elsewhere.
macro_rules! jetbrains {
    ($id:literal, $name:literal, $launcher:literal) => {
        Known {
            id: $id,
            name: $name,
            args: LineArgs::LongLine,
            windows: &[
                Spot::OnPath(concat!($launcher, "64.exe")),
                Spot::ProgramFiles(concat!("JetBrains/*/bin/", $launcher, "64.exe")),
                Spot::LocalAppData(concat!("Programs/*/bin/", $launcher, "64.exe")),
            ],
            mac: &[
                Spot::OnPath($launcher),
                Spot::Applications(concat!("*.app/Contents/MacOS/", $launcher)),
            ],
            linux: &[
                Spot::OnPath($launcher),
                Spot::OnPath(concat!($launcher, ".sh")),
            ],
        }
    };
}

/// The editors the chooser offers, in the order modders use them most.
const KNOWN: &[Known] = &[
    Known {
        id: "vscode",
        name: "VS Code",
        args: LineArgs::Goto,
        windows: &[
            Spot::ScriptOnPath("code.cmd", "Code.exe"),
            Spot::LocalAppData("Programs/Microsoft VS Code/Code.exe"),
            Spot::ProgramFiles("Microsoft VS Code/Code.exe"),
        ],
        mac: &[
            Spot::OnPath("code"),
            Spot::Applications("Visual Studio Code.app/Contents/Resources/app/bin/code"),
        ],
        linux: &[Spot::OnPath("code")],
    },
    Known {
        id: "vscode_insiders",
        name: "VS Code Insiders",
        args: LineArgs::Goto,
        windows: &[
            Spot::ScriptOnPath("code-insiders.cmd", "Code - Insiders.exe"),
            Spot::LocalAppData("Programs/Microsoft VS Code Insiders/Code - Insiders.exe"),
            Spot::ProgramFiles("Microsoft VS Code Insiders/Code - Insiders.exe"),
        ],
        mac: &[
            Spot::OnPath("code-insiders"),
            Spot::Applications(
                "Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code-insiders",
            ),
        ],
        linux: &[Spot::OnPath("code-insiders")],
    },
    Known {
        id: "vscodium",
        name: "VSCodium",
        args: LineArgs::Goto,
        windows: &[
            Spot::ScriptOnPath("codium.cmd", "VSCodium.exe"),
            Spot::LocalAppData("Programs/VSCodium/VSCodium.exe"),
            Spot::ProgramFiles("VSCodium/VSCodium.exe"),
        ],
        mac: &[
            Spot::OnPath("codium"),
            Spot::Applications("VSCodium.app/Contents/Resources/app/bin/codium"),
        ],
        linux: &[Spot::OnPath("codium")],
    },
    Known {
        id: "notepad_plus_plus",
        name: "Notepad++",
        args: LineArgs::AttachedN,
        windows: &[
            Spot::OnPath("notepad++.exe"),
            Spot::ProgramFiles("Notepad++/notepad++.exe"),
            Spot::AppPath("notepad++.exe"),
        ],
        mac: &[],
        linux: &[],
    },
    Known {
        id: "sublime_text",
        name: "Sublime Text",
        args: LineArgs::Suffix,
        windows: &[
            Spot::OnPath("subl.exe"),
            Spot::ProgramFiles("Sublime Text/subl.exe"),
            Spot::ProgramFiles("Sublime Text 3/subl.exe"),
        ],
        mac: &[
            Spot::OnPath("subl"),
            Spot::Applications("Sublime Text.app/Contents/SharedSupport/bin/subl"),
        ],
        linux: &[Spot::OnPath("subl")],
    },
    jetbrains!("intellij_idea", "IntelliJ IDEA", "idea"),
    jetbrains!("pycharm", "PyCharm", "pycharm"),
    jetbrains!("webstorm", "WebStorm", "webstorm"),
    jetbrains!("phpstorm", "PhpStorm", "phpstorm"),
    jetbrains!("rider", "Rider", "rider"),
    jetbrains!("clion", "CLion", "clion"),
    jetbrains!("goland", "GoLand", "goland"),
    jetbrains!("rustrover", "RustRover", "rustrover"),
    Known {
        id: "kate",
        name: "Kate",
        args: LineArgs::ShortL,
        windows: &[
            Spot::OnPath("kate.exe"),
            Spot::ProgramFiles("Kate/bin/kate.exe"),
        ],
        mac: &[
            Spot::OnPath("kate"),
            Spot::Applications("kate.app/Contents/MacOS/kate"),
        ],
        linux: &[Spot::OnPath("kate")],
    },
];

/// An editor found on this machine: what the chooser shows, and the program that opens a file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Editor {
    pub view: EditorView,
    pub program: PathBuf,
    args: LineArgs,
}

/// A program and the arguments to start it with.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Launch {
    pub program: PathBuf,
    pub args: Vec<OsString>,
    /// Started without a console window: a found editor's command-line helper, such as
    /// `subl.exe`, would open one. A program the user picked may need its console.
    pub no_console: bool,
}

impl Editor {
    /// How this editor opens `file` at `line`, or at its top without one.
    pub fn launch(&self, file: &Path, line: Option<u32>) -> Launch {
        Launch {
            program: self.program.clone(),
            args: line_args(self.args, file, line),
            no_console: true,
        }
    }
}

fn line_args(style: LineArgs, file: &Path, line: Option<u32>) -> Vec<OsString> {
    let file = file.as_os_str().to_owned();
    let Some(line) = line else {
        return vec![file];
    };
    let at = || {
        let mut at = file.clone();
        at.push(format!(":{line}"));
        at
    };
    match style {
        LineArgs::Goto => vec!["-g".into(), at()],
        LineArgs::AttachedN => vec![format!("-n{line}").into(), file],
        LineArgs::Suffix => vec![at()],
        LineArgs::LongLine => vec!["--line".into(), line.to_string().into(), file],
        LineArgs::ShortL => vec!["-l".into(), line.to_string().into(), file],
    }
}

/// The editors of [`KNOWN`] that `places` hold on `platform`, each at the first spot it is found.
pub fn detect(platform: Platform, places: &Places) -> Vec<Editor> {
    KNOWN
        .iter()
        .filter_map(|known| {
            let program = known
                .spots(platform)
                .iter()
                .find_map(|spot| find(*spot, places))?;
            Some(Editor {
                view: EditorView {
                    id: known.id.to_owned(),
                    name: known.name.to_owned(),
                },
                program,
                args: known.args,
            })
        })
        .collect()
}

fn find(spot: Spot, places: &Places) -> Option<PathBuf> {
    match spot {
        Spot::OnPath(name) => places
            .path
            .iter()
            .map(|dir| dir.join(name))
            .find(|program| program.is_file()),
        Spot::ScriptOnPath(script, name) => places
            .path
            .iter()
            .filter(|dir| dir.join(script).is_file())
            .filter_map(|dir| Some(dir.parent()?.join(name)))
            .find(|program| program.is_file()),
        Spot::LocalAppData(rel) => places
            .local_app_data
            .iter()
            .find_map(|root| matching(root, rel)),
        Spot::ProgramFiles(rel) => places
            .program_files
            .iter()
            .find_map(|root| matching(root, rel)),
        Spot::Applications(rel) => places
            .applications
            .iter()
            .find_map(|root| matching(root, rel)),
        Spot::AppPath(name) => places
            .app_paths
            .get(name)
            .filter(|program| program.is_file())
            .cloned(),
    }
}

/// The file `rel` names below `root`; of several a `*` part matches, the last by name, which is
/// the newest version where folders are named for one.
fn matching(root: &Path, rel: &str) -> Option<PathBuf> {
    let mut found = vec![root.to_path_buf()];
    for part in rel.split('/') {
        found = match part.strip_prefix('*') {
            None => found.into_iter().map(|dir| dir.join(part)).collect(),
            Some(suffix) => found.iter().flat_map(|dir| folders(dir, suffix)).collect(),
        };
    }
    found.into_iter().rev().find(|file| file.is_file())
}

/// The folders in `dir` whose names end with `suffix`, by name.
fn folders(dir: &Path, suffix: &str) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut out: Vec<PathBuf> = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_dir()
                && path
                    .file_name()
                    .is_some_and(|name| name.to_string_lossy().ends_with(suffix))
        })
        .collect();
    out.sort();
    out
}

/// The editors on this machine, looked for on the first call of a run.
pub fn found() -> &'static [Editor] {
    static FOUND: OnceLock<Vec<Editor>> = OnceLock::new();
    FOUND.get_or_init(|| {
        let platform = Platform::current();
        detect(platform, &Places::here(platform))
    })
}

/// How `pick` opens `file` at `line`, `picked` the program picked for Other…: `None` for the
/// system default, for an editor `found` no longer holds, and for Other… with no program.
pub fn launch_for(
    pick: &EditorPick,
    found: &[Editor],
    picked: Option<&Path>,
    file: &Path,
    line: Option<u32>,
) -> Option<Launch> {
    match pick {
        EditorPick::Found { id } => found
            .iter()
            .find(|editor| editor.view.id == *id)
            .map(|editor| editor.launch(file, line)),
        EditorPick::SystemDefault => None,
        EditorPick::Other { args } => picked.map(|program| other(program, args, file, line)),
    }
}

/// The program the user picked and its arguments: `args` split at spaces, a part in double
/// quotes kept whole, `{file}` and `{line}` put in, the line 1 without one. The file goes last
/// when `args` does not place it. A Mac app bundle is a folder, so `open -a` starts it.
fn other(program: &Path, args: &str, file: &Path, line: Option<u32>) -> Launch {
    let line = line.unwrap_or(1).to_string();
    let parts = split_args(args);
    let mut out: Vec<OsString> = parts
        .iter()
        .map(|part| put_in(part, file.as_os_str(), &line))
        .collect();
    if !parts.iter().any(|part| part.contains("{file}")) {
        out.push(file.as_os_str().to_owned());
    }
    if is_app_bundle(program) {
        let mut args: Vec<OsString> = vec!["-a".into(), program.into(), "--args".into()];
        args.append(&mut out);
        return Launch {
            program: PathBuf::from("open"),
            args,
            no_console: false,
        };
    }
    Launch {
        program: program.to_path_buf(),
        args: out,
        no_console: false,
    }
}

fn is_app_bundle(program: &Path) -> bool {
    program
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("app"))
        && program.is_dir()
}

fn split_args(args: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut part = String::new();
    let mut quoted = false;
    let mut started = false;
    for c in args.chars() {
        match c {
            '"' => {
                quoted = !quoted;
                started = true;
            }
            c if c.is_whitespace() && !quoted => {
                if started {
                    parts.push(std::mem::take(&mut part));
                    started = false;
                }
            }
            c => {
                part.push(c);
                started = true;
            }
        }
    }
    if started {
        parts.push(part);
    }
    parts
}

fn put_in(part: &str, file: &OsStr, line: &str) -> OsString {
    let mut out = OsString::new();
    for (index, piece) in part.split("{file}").enumerate() {
        if index > 0 {
            out.push(file);
        }
        out.push(piece.replace("{line}", line));
    }
    out
}

/// Start `launch` without waiting for the program to close. Windows ignores the no-console flag
/// for a program that is not a console program, so a GUI editor's window still shows.
pub fn start(launch: &Launch) -> std::io::Result<()> {
    let mut command = Command::new(&launch.program);
    command.args(&launch.args);
    if launch.no_console {
        no_console(&mut command);
    }
    let mut child = command.spawn()?;
    std::thread::spawn(move || child.wait());
    Ok(())
}

/// The program picked for Other…, kept in the JSON file `store`; `None` when none was picked,
/// or the file is unreadable.
pub fn picked_program(store: &Path) -> Option<PathBuf> {
    let text = std::fs::read_to_string(store).ok()?;
    let picked: Picked = serde_json::from_str(&text).ok()?;
    Some(picked.program)
}

/// Keeps `program` as the one picked for Other… in the JSON file `store`.
pub fn keep_program(store: &Path, program: &Path) -> std::io::Result<()> {
    if let Some(dir) = store.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let picked = Picked {
        program: program.to_path_buf(),
    };
    let text = serde_json::to_string_pretty(&picked).map_err(std::io::Error::other)?;
    std::fs::write(store, text)
}

/// What a button calls `program`: its file name.
pub fn program_name(program: &Path) -> String {
    program.file_name().map_or_else(
        || program.display().to_string(),
        |name| name.to_string_lossy().into_owned(),
    )
}

#[derive(Serialize, Deserialize)]
struct Picked {
    program: PathBuf,
}

/// The file the program picked for Other… is kept in: `editor.json` in the app's config
/// folder, unless a test points it elsewhere.
#[derive(Default)]
pub struct PickedProgramFile(Mutex<Option<PathBuf>>);

impl PickedProgramFile {
    pub fn point_at(&self, store: PathBuf) {
        *self.0.lock().unwrap_or_else(|e| e.into_inner()) = Some(store);
    }

    pub fn get(&self) -> Option<PathBuf> {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }
}

/// The name of the file in the app's config folder that [`PickedProgramFile`] defaults to.
pub const PICKED_PROGRAM_FILE: &str = "editor.json";

/// Steam replaces `file` when the game or a mod updates: it is under the game's `install`, or
/// in a Workshop download.
pub fn steam_replaces(file: &Path, install: Option<&Path>) -> bool {
    let written = file
        .to_string_lossy()
        .replace('\\', "/")
        .to_ascii_lowercase();
    written.contains("/steamapps/workshop/") || install.is_some_and(|root| is_under(file, root))
}

fn is_under(file: &Path, root: &Path) -> bool {
    match (file.canonicalize(), root.canonicalize()) {
        (Ok(file), Ok(root)) => file.starts_with(root),
        _ => file.starts_with(root),
    }
}
