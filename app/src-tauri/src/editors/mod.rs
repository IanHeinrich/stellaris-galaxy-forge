//! The text editors a modder opens script files in: which of them this machine has, and the
//! program and arguments that open a file at a line in each. Nothing here goes through a
//! shell: a program is started with its arguments as a list.

mod detect;
mod launch;

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::state::relock;
use sgf_core::paths;

pub use detect::{Editor, Places, Platform, detect, found};
pub use launch::{Launch, launch_for, start};

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
        *relock(&self.0) = Some(store);
    }

    pub fn get(&self) -> Option<PathBuf> {
        relock(&self.0).clone()
    }
}

/// The program Browse… found while the chooser is open, kept only once the chooser's answer is
/// Other….
#[derive(Default)]
pub struct PendingProgram(Mutex<Option<PathBuf>>);

impl PendingProgram {
    pub fn set(&self, program: PathBuf) {
        *relock(&self.0) = Some(program);
    }

    pub fn take(&self) -> Option<PathBuf> {
        relock(&self.0).take()
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
    written.contains("/steamapps/workshop/")
        || install.is_some_and(|root| paths::is_under(file, root))
}
