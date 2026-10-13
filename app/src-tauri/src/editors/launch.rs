//! The program and arguments that open a file at a line in an editor, and starting them.

use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};
use std::process::Command;

use super::EditorPick;
use super::detect::Editor;

/// How an editor is told the line to open a file at.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum LineArgs {
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
/// when `args` does not place it. A Mac app bundle is a folder, so `open -a` starts it: with the
/// file alone, as a document a running copy opens too, and otherwise after `--args`, which only a
/// new copy reads.
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
        let mut args: Vec<OsString> = vec!["-a".into(), program.into()];
        if out.len() != 1 || out[0] != *file.as_os_str() {
            args.push("--args".into());
        }
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

#[cfg(windows)]
fn no_console(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn no_console(_: &mut Command) {}
