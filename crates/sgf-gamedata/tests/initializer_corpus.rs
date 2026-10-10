//! Every installed mod's initializers, enabled or not, read over the base game and resolved
//! the way the scenario view resolves them, when `SGF_INITIALIZER_CORPUS=1` asks for it.
//! Nothing is read from a mod into the repository: the test prints ids, file names and counts.

use std::fs;
use std::panic::{self, AssertUnwindSafe};
use std::path::{Path, PathBuf};
use std::time::Instant;

use sgf_core::cst;
use sgf_gamedata::install::discovery::{find_install, steam_libraries};
use sgf_gamedata::install::layers::VANILLA;
use sgf_gamedata::install::mods::{enabled_mods, installed_mods};
use sgf_gamedata::{Diagnostic, GameData, LoadOptions, load};

mod key_coverage;

use key_coverage::{Context, Coverage};

const INITIALIZERS: &str = "common/solar_system_initializers";
const SCRIPTED_VARIABLES: &str = "common/scripted_variables";
const WORKSHOP_CONTENT: &str = "steamapps/workshop/content/281990";
const ROLLS: u32 = 3;
const WITHIN: f64 = 400.0;
/// Dropped statements the output lists one by one.
const SHOWN: usize = 30;

struct Source {
    name: String,
    workshop_id: String,
    dir: PathBuf,
    replace_paths: Vec<String>,
    enabled: bool,
}

#[derive(Default)]
struct Tally {
    initializers: usize,
    resolved: usize,
    with_bodies: usize,
}

fn same_dir(a: &Path, b: &Path) -> bool {
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(a), Ok(b)) => a == b,
        _ => a == b,
    }
}

fn is_excluded(name: &str, id: &str, dir: &Path) -> bool {
    let folder = dir
        .file_name()
        .map(|f| f.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let name = name.trim().to_lowercase();
    let id = id.to_lowercase();
    name.starts_with("sgf_")
        || id.starts_with("sgf_")
        || folder.starts_with("sgf_")
        || folder == "stellaris-galaxy-forge"
        || id == "stellaris-galaxy-forge"
        || name.starts_with("(merged)")
        || folder.starts_with("(merged)")
        || id.starts_with("(merged)")
        || name.starts_with("ironymodmanager_")
        || id.starts_with("ironymodmanager_")
        || folder.starts_with("ironymodmanager_")
}

fn workshop_id(dir: &Path) -> String {
    let folder = dir
        .file_name()
        .map(|f| f.to_string_lossy().into_owned())
        .unwrap_or_default();
    if !folder.is_empty() && folder.bytes().all(|b| b.is_ascii_digit()) {
        folder
    } else {
        "local".to_owned()
    }
}

/// Every mod with initializers on this machine: the launcher's `.mod` files first, then the
/// Workshop folders no `.mod` file points to.
fn installed_sources(user_dir: &Path) -> Vec<Source> {
    let libraries = steam_libraries();
    let mut diagnostics = Vec::new();
    let enabled = enabled_mods(user_dir, &libraries, &mut diagnostics);
    let mut sources: Vec<Source> = Vec::new();
    let mut consider = |name: String, id: String, dir: PathBuf, replace_paths: Vec<String>| {
        if !dir.join(INITIALIZERS).is_dir()
            || is_excluded(&name, &id, &dir)
            || sources.iter().any(|s| same_dir(&s.dir, &dir))
        {
            return;
        }
        let enabled = enabled
            .iter()
            .any(|m| m.dir.as_deref().is_some_and(|d| same_dir(d, &dir)));
        sources.push(Source {
            name,
            workshop_id: workshop_id(&dir),
            dir,
            replace_paths,
            enabled,
        });
    };

    for m in installed_mods(user_dir, &libraries, &mut diagnostics) {
        if let Some(dir) = m.dir {
            consider(m.name, m.id, dir, m.replace_paths);
        }
    }
    for library in &libraries {
        let Ok(entries) = fs::read_dir(library.join(WORKSHOP_CONTENT)) else {
            continue;
        };
        let mut dirs: Vec<PathBuf> = entries
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.is_dir())
            .collect();
        dirs.sort();
        for dir in dirs {
            let (name, replace_paths) = descriptor(&dir.join("descriptor.mod"));
            let id = workshop_id(&dir);
            consider(name.unwrap_or_else(|| id.clone()), id, dir, replace_paths);
        }
    }
    sources.sort_by(|a, b| (!a.enabled, &a.name).cmp(&(!b.enabled, &b.name)));
    sources
}

fn descriptor(file: &Path) -> (Option<String>, Vec<String>) {
    let Ok(bytes) = fs::read(file) else {
        return (None, Vec::new());
    };
    let Ok(root) = cst::parse_script(&bytes, 0) else {
        return (None, Vec::new());
    };
    let name = root
        .find("name", &bytes)
        .and_then(|n| n.scalar_str(&bytes))
        .map(str::to_owned);
    let replace_paths = root
        .find_all("replace_path", &bytes)
        .filter_map(|n| n.scalar_str(&bytes))
        .map(str::to_owned)
        .collect();
    (name, replace_paths)
}

/// Vanilla with `source` over it, as the app loads an enabled playset of one mod.
fn load_over_vanilla(install: &Path, source: Option<&Source>) -> Result<GameData, String> {
    let scratch = tempfile::tempdir().map_err(|e| e.to_string())?;
    let mut options = LoadOptions {
        install: Some(install.to_path_buf()),
        user_dir: Some(scratch.path().to_path_buf()),
        language: "english".to_owned(),
        mods: false,
    };
    if let Some(source) = source {
        let mod_dir = scratch.path().join("mod");
        fs::create_dir_all(&mod_dir).map_err(|e| e.to_string())?;
        let mut text = format!(
            "name=\"{}\"\npath=\"{}\"\n",
            source.name.replace('"', ""),
            source.dir.to_string_lossy().replace('\\', "/")
        );
        for path in &source.replace_paths {
            text.push_str(&format!("replace_path=\"{path}\"\n"));
        }
        fs::write(mod_dir.join("corpus.mod"), text).map_err(|e| e.to_string())?;
        fs::write(
            scratch.path().join("dlc_load.json"),
            r#"{"enabled_mods":["mod/corpus.mod"]}"#,
        )
        .map_err(|e| e.to_string())?;
        options.mods = true;
    }
    let result = panic::catch_unwind(AssertUnwindSafe(|| load(&options, &mut |_| {})));
    match result {
        Ok(Ok(gd)) => Ok(gd),
        Ok(Err(e)) => Err(e.to_string()),
        Err(payload) => Err(format!("panicked while loading: {}", message(&payload))),
    }
}

fn message(payload: &Box<dyn std::any::Any + Send>) -> String {
    payload
        .downcast_ref::<&str>()
        .map(|s| (*s).to_owned())
        .or_else(|| payload.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "non-text panic".to_owned())
}

fn in_layer(gd: &GameData, layer: &str, file: &Path) -> bool {
    gd.layout
        .layer_of(file)
        .is_some_and(|(found, _)| found.name == layer)
}

fn file_name(file: &Path) -> String {
    file.file_name()
        .map(|f| f.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// Resolves every initializer `layer` supplies, checks that its details keep every statement of
/// the block, and returns what it counted and what failed.
fn resolve_layer(
    gd: &GameData,
    layer: &str,
    failures: &mut Vec<String>,
    coverage: &mut Coverage,
) -> (Tally, usize) {
    let files = gd
        .layout
        .files_in(INITIALIZERS)
        .into_iter()
        .filter(|f| in_layer(gd, layer, f))
        .count();

    let mut tally = Tally::default();
    for (index, init) in gd
        .initializers
        .iter()
        .filter(|init| in_layer(gd, layer, &init.source))
        .enumerate()
    {
        tally.initializers += 1;
        let id = u32::try_from(index).unwrap_or(u32::MAX);
        let outcome = panic::catch_unwind(AssertUnwindSafe(|| {
            let details = gd.initializer_details(id, &init.name, None);
            for roll in 0..ROLLS {
                gd.system_roll(id, &init.name, "", roll, WITHIN);
            }
            details
        }));
        match outcome {
            Ok(Some(details)) => {
                tally.resolved += 1;
                if !details.planets.is_empty() {
                    tally.with_bodies += 1;
                }
                if let Some(def) = gd.initializers.spliced(&init.name) {
                    let context = Context {
                        source: layer,
                        initializer: &init.name,
                        file: &file_name(&init.source),
                    };
                    key_coverage::check(def, &details, &context, coverage);
                }
            }
            Ok(None) => failures.push(format!(
                "{layer}: {} ({}): did not resolve",
                init.name,
                file_name(&init.source)
            )),
            Err(payload) => failures.push(format!(
                "{layer}: {} ({}): panicked: {}",
                init.name,
                file_name(&init.source),
                message(&payload)
            )),
        }
    }

    for diagnostic in &gd.diagnostics {
        let (Diagnostic::ParseError { file, .. } | Diagnostic::Unreadable { file, .. }) =
            diagnostic
        else {
            continue;
        };
        let path = file.to_string_lossy().replace('\\', "/");
        let reads_initializers = path.contains(&format!("{INITIALIZERS}/"))
            || path.contains(&format!("{SCRIPTED_VARIABLES}/"));
        if reads_initializers && in_layer(gd, layer, file) {
            failures.push(format!("{layer}: {diagnostic}"));
        }
    }
    (tally, files)
}

#[test]
fn every_installed_mods_initializers_resolve() {
    if std::env::var_os("SGF_INITIALIZER_CORPUS").is_none_or(|v| v != "1") {
        eprintln!("skipped: SGF_INITIALIZER_CORPUS=1 reads every installed mod's initializers");
        return;
    }
    let install = find_install(None).expect("SGF_INITIALIZER_CORPUS needs an install");
    let user_dir = sgf_core::library::paradox_user_dir()
        .filter(|d| d.is_dir())
        .expect("SGF_INITIALIZER_CORPUS needs the launcher's user directory");

    let mut sources: Vec<Option<Source>> = vec![None];
    sources.extend(installed_sources(&user_dir).into_iter().map(Some));

    let mut failures = Vec::new();
    let mut coverages: Vec<(String, Coverage)> = Vec::new();
    println!(
        "{:<44} {:<12} {:<9} {:>5} {:>7} {:>8} {:>7} {:>6} {:>8}",
        "source",
        "workshop id",
        "enabled",
        "files",
        "inits",
        "resolved",
        "bodies",
        "load s",
        "resolve s"
    );
    for source in &sources {
        let started = Instant::now();
        let (name, id, enabled, layer) = match source {
            Some(s) => (
                s.name.as_str(),
                s.workshop_id.as_str(),
                if s.enabled { "yes" } else { "no" },
                s.name.as_str(),
            ),
            None => ("Stellaris (vanilla)", "-", "yes", VANILLA),
        };
        let gd = match load_over_vanilla(&install, source.as_ref()) {
            Ok(gd) => gd,
            Err(e) => {
                println!("{name:<44} {id:<12} {enabled:<9} failed to load");
                failures.push(format!("{name}: {e}"));
                continue;
            }
        };
        let loaded = started.elapsed().as_secs_f64();
        let mut coverage = Coverage::default();
        let (tally, files) = resolve_layer(&gd, layer, &mut failures, &mut coverage);
        coverages.push((name.to_owned(), coverage));
        println!(
            "{name:<44} {id:<12} {enabled:<9} {files:>5} {:>7} {:>8} {:>7} {loaded:>6.1} {:>8.1}",
            tally.initializers,
            tally.resolved,
            tally.with_bodies,
            started.elapsed().as_secs_f64() - loaded
        );
    }

    println!();
    println!("statements the details keep, raw keys by count");
    let mut total = Coverage::default();
    for (name, coverage) in coverages {
        coverage.print_raw_keys(&name);
        total.merge(coverage);
    }
    total.print_raw_keys("all sources");

    failures.append(&mut total.problems);
    println!();
    total.print_dropped(SHOWN);
    println!("{} failures", failures.len());
    for failure in &failures {
        println!("{failure}");
    }
    assert!(
        failures.is_empty() && total.dropped.is_empty(),
        "{} failures, {} dropped statements",
        failures.len(),
        total.dropped.len()
    );
}
