use std::fs;
use std::path::{Path, PathBuf};
use std::process::exit;

// steamworks-sys leaves steam_api64.dll in its own OUT_DIR, which only
// `cargo run` puts on PATH. Copy it next to the exe so the exe runs alone.
// steamworks-sys is a build-dependency only so that its build script has
// run before this one.
fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }
    let out_dir = PathBuf::from(std::env::var("OUT_DIR").unwrap_or_default());
    let Some(profile_dir) = out_dir.ancestors().nth(3) else {
        fail(&format!(
            "OUT_DIR {} is not under target/",
            out_dir.display()
        ));
    };
    let Some(dll) = build_dirs(profile_dir)
        .iter()
        .filter_map(|dir| newest_steam_dll(dir))
        .max_by_key(|dll| dll.metadata().and_then(|m| m.modified()).ok())
    else {
        fail(&format!(
            "no steamworks-sys build folder under {} has steam_api64.dll",
            profile_dir.display()
        ));
    };
    if let Err(e) = fs::copy(&dll, profile_dir.join("steam_api64.dll")) {
        fail(&format!("cannot copy {}: {e}", dll.display()));
    }
    println!("cargo:rerun-if-changed={}", dll.display());
}

/// target/<profile>/build and target/<triple>/<profile>/build: with
/// `--target`, host builds such as build-dependencies land in the first.
fn build_dirs(profile_dir: &Path) -> Vec<PathBuf> {
    let mut dirs = vec![profile_dir.join("build")];
    let triple = std::env::var("TARGET").unwrap_or_default();
    let parent = profile_dir.parent();
    if let (Some(parent), Some(profile)) = (parent, profile_dir.file_name())
        && parent
            .file_name()
            .is_some_and(|name| name == triple.as_str())
        && let Some(target_root) = parent.parent()
    {
        dirs.push(target_root.join(profile).join("build"));
    }
    dirs
}

fn newest_steam_dll(build_dir: &Path) -> Option<PathBuf> {
    fs::read_dir(build_dir)
        .ok()?
        .filter_map(|entry| entry.ok())
        .filter(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .starts_with("steamworks-sys-")
        })
        .map(|entry| entry.path().join("out").join("steam_api64.dll"))
        .filter(|dll| dll.is_file())
        .max_by_key(|dll| dll.metadata().and_then(|m| m.modified()).ok())
}

fn fail(message: &str) -> ! {
    eprintln!("error: {message}");
    exit(1)
}
