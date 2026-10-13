//! Which of the known editors this machine has, looked for in the places each platform
//! installs them.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use super::EditorView;
use super::launch::LineArgs;

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

/// The program `name`'s App Paths entry, the default value of its key under
/// `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths`.
#[cfg(windows)]
fn app_path(name: &str) -> Option<PathBuf> {
    let key = windows_registry::LOCAL_MACHINE
        .open(format!(
            r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\{name}"
        ))
        .ok()?;
    let path = key.get_string("").ok()?;
    (!path.is_empty()).then(|| PathBuf::from(path))
}

#[cfg(not(windows))]
fn app_path(_: &str) -> Option<PathBuf> {
    None
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
    pub(super) args: LineArgs,
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
