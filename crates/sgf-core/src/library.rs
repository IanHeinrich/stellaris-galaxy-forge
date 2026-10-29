//! What an Open screen lists as saves: where this machine keeps them, and what stands in
//! each campaign folder. Reading a `.sav` itself is [`crate::archive`]'s job; this only
//! finds the files and opens as few of them as a listing needs.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::archive::{SaveMeta, read_meta_only};
use crate::paths;

/// Stellaris on Steam, which names its Steam Cloud directory.
const STELLARIS_APP_ID: &str = "281990";

/// The folder the game writes saves into, under the user folder and under Steam Cloud's.
const SAVE_GAMES: &str = "save games";

/// One `.sav` found under a Stellaris save directory.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SaveFile {
    pub path: String,
    /// The folder the file sits in; the game lists these as campaigns.
    pub campaign: String,
    pub file_name: String,
    /// `None` when the archive could not be read; the entry is still listed.
    pub meta: Option<SaveMeta>,
    /// Last modification, seconds since the Unix epoch.
    #[ts(type = "number")]
    pub modified: i64,
    #[ts(type = "number")]
    pub size: u64,
    /// Under a Steam Cloud directory, where Steam may overwrite the file with its cloud copy.
    pub cloud: bool,
}

/// A campaign folder as a save list shows it before its saves are read: the file names
/// it holds, when it was last written, and the header of its newest save (one archive
/// opened per folder, not one per save).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CampaignListing {
    /// The folder itself, the argument [`list_campaign_saves`] takes.
    pub dir: String,
    /// The folder's name, which the game lists as the campaign.
    pub name: String,
    /// Empire name of the newest save.
    pub empire: Option<String>,
    /// Every save's file name, newest first, from the folder listing alone.
    pub file_names: Vec<String>,
    /// Newest save's modification, seconds since the Unix epoch.
    #[ts(type = "number")]
    pub newest: i64,
    /// Read from the newest save only; `None` when that archive could not be read.
    pub meta: Option<SaveMeta>,
    /// See [`SaveFile::cloud`].
    pub cloud: bool,
}

/// The save directory under the user folder `user_dir`, when it exists.
pub fn find_save_dirs(user_dir: Option<&Path>) -> Vec<PathBuf> {
    user_dir
        .map(|dir| dir.join(SAVE_GAMES))
        .filter(|p| p.is_dir())
        .into_iter()
        .collect()
}

/// The save directories this machine has: the one under the user folder `user_dir`, then
/// the Steam Cloud ones.
pub fn save_roots(user_dir: Option<&Path>) -> Vec<(PathBuf, bool)> {
    find_save_dirs(user_dir)
        .into_iter()
        .map(|d| (d, false))
        .chain(find_cloud_save_dirs().into_iter().map(|d| (d, true)))
        .collect()
}

/// Every campaign folder under [`save_roots`], newest first.
pub fn list_campaigns(user_dir: Option<&Path>) -> Vec<CampaignListing> {
    list_campaigns_in(&save_roots(user_dir))
}

/// Every folder under `roots` holding at least one `.sav`, newest first: each root
/// itself, for the saves the game wrote loose, and each of its campaign folders.
pub fn list_campaigns_in(roots: &[(PathBuf, bool)]) -> Vec<CampaignListing> {
    let mut campaigns: Vec<CampaignListing> = roots
        .iter()
        .flat_map(|(dir, cloud)| {
            std::iter::once(dir.clone())
                .chain(subdirs(dir))
                .filter_map(|d| campaign_listing(&d, *cloud))
        })
        .collect();
    campaigns.sort_by(|a, b| b.newest.cmp(&a.newest).then(a.dir.cmp(&b.dir)));
    campaigns
}

/// Every `.sav` directly in the campaign folder `dir`, newest first.
pub fn list_campaign_saves(dir: &Path) -> Vec<SaveFile> {
    list_campaign_saves_in(dir, is_cloud_save(dir))
}

/// [`list_campaign_saves`] with the Steam Cloud flag supplied rather than discovered.
pub fn list_campaign_saves_in(dir: &Path, cloud: bool) -> Vec<SaveFile> {
    let mut saves = Vec::new();
    collect_saves(dir, &dir_name(dir), cloud, &mut saves);
    sort_newest_first(&mut saves);
    saves
}

/// `dir` as a campaign, or `None` when it holds no save. Only the newest save's archive
/// is opened.
fn campaign_listing(dir: &Path, cloud: bool) -> Option<CampaignListing> {
    let mut entries = sav_entries(dir);
    entries.sort_by(|a, b| b.modified.cmp(&a.modified).then(a.path.cmp(&b.path)));
    let newest = entries.first()?;
    let meta = read_meta_only(&newest.path).ok();
    Some(CampaignListing {
        dir: dir.to_string_lossy().into_owned(),
        name: dir_name(dir),
        empire: meta.as_ref().map(|m| m.name.clone()),
        newest: newest.modified,
        meta,
        cloud,
        file_names: entries.into_iter().map(|e| e.file_name).collect(),
    })
}

fn sort_newest_first(saves: &mut [SaveFile]) {
    saves.sort_by(|a, b| b.modified.cmp(&a.modified).then(a.path.cmp(&b.path)));
}

fn dir_name(dir: &Path) -> String {
    dir.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn subdirs(dir: &Path) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .collect();
    dirs.sort();
    dirs
}

/// A `.sav` found on disk, before its archive is opened.
struct SavEntry {
    path: PathBuf,
    file_name: String,
    modified: i64,
    size: u64,
}

/// Every `.sav` directly under `dir`, in whatever order the filesystem gives them.
fn sav_entries(dir: &Path) -> Vec<SavEntry> {
    fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            if !path.is_file()
                || !path
                    .extension()
                    .is_some_and(|e| e.eq_ignore_ascii_case("sav"))
            {
                return None;
            }
            let md = entry.metadata().ok()?;
            Some(SavEntry {
                path,
                file_name: entry.file_name().to_string_lossy().into_owned(),
                modified: md
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map_or(0, |d| i64::try_from(d.as_secs()).unwrap_or(i64::MAX)),
                size: md.len(),
            })
        })
        .collect()
}

fn collect_saves(dir: &Path, campaign: &str, cloud: bool, out: &mut Vec<SaveFile>) {
    out.extend(sav_entries(dir).into_iter().map(|entry| SaveFile {
        path: entry.path.to_string_lossy().into_owned(),
        campaign: campaign.to_owned(),
        file_name: entry.file_name,
        meta: read_meta_only(&entry.path).ok(),
        modified: entry.modified,
        size: entry.size,
        cloud,
    }));
}

/// Where the Stellaris user folder came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum UserDirSource {
    /// The player chose it.
    Chosen,
    /// `gameDataPath` in the install's `launcher-settings.json`, where it names a folder
    /// other than the default.
    LauncherSettings,
    /// `Documents/Paradox Interactive/Stellaris`, or `~/.local/share/Paradox
    /// Interactive/Stellaris` on Linux.
    Default,
}

/// The Stellaris user folder, which holds `mod/`, `dlc_load.json`, `mods_registry.json` and
/// `save games/`, and where it came from. The folder may not exist.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct UserDir {
    pub path: PathBuf,
    pub source: UserDirSource,
}

/// What [`resolve_user_dir`] found.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UserDirLookup {
    /// `None` only when this machine has no folder to default to.
    pub dir: Option<UserDir>,
    /// The launcher's `gameDataPath` when it could not be followed and named a folder other
    /// than the default.
    pub ignored: Option<IgnoredGameDataPath>,
}

/// Why a `gameDataPath` was not followed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IgnoredGameDataPath {
    /// It starts with a token other than `%USER_DOCUMENTS%` and `$LINUX_DATA_HOME`.
    UnknownToken { value: String },
    /// It is a relative path, which names no one folder.
    Relative { value: String },
    /// It names no folder on this machine.
    Missing { value: String, path: PathBuf },
}

impl std::fmt::Display for IgnoredGameDataPath {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::UnknownToken { value } => {
                write!(f, "gameDataPath \"{value}\" starts with an unknown token")
            }
            Self::Relative { value } => {
                write!(f, "gameDataPath \"{value}\" is not a full path")
            }
            Self::Missing { value, path } => write!(
                f,
                "gameDataPath \"{value}\" names no folder ({})",
                path.display()
            ),
        }
    }
}

/// A folder this machine may have, such as its documents folder.
type KnownFolder = fn() -> Option<PathBuf>;

/// The tokens a `gameDataPath` may start with, and the folder each stands for.
const GAME_DATA_PATH_TOKENS: [(&str, KnownFolder); 2] = [
    ("%USER_DOCUMENTS%", dirs::document_dir),
    ("$LINUX_DATA_HOME", dirs::data_dir),
];

/// The Stellaris user folder: `chosen`, else the launcher's `gameDataPath` (as written in
/// `launcher-settings.json`) when it names a folder that exists, else the default. An empty
/// `gameDataPath` is no `gameDataPath`.
pub fn resolve_user_dir(chosen: Option<&Path>, game_data_path: Option<&str>) -> UserDirLookup {
    if let Some(path) = chosen {
        return UserDirLookup {
            dir: Some(UserDir {
                path: path.to_path_buf(),
                source: UserDirSource::Chosen,
            }),
            ignored: None,
        };
    }
    let default = paradox_user_dir();
    let game_data_path = game_data_path.filter(|value| !value.trim().is_empty());
    let is_default = |path: &Path| {
        default
            .as_deref()
            .is_some_and(|d| paths::same_file(path, d))
    };
    let ignored = match game_data_path.map(|value| (value, expand_game_data_path(value))) {
        Some((_, Ok(Some(path)))) if is_default(&path) => None,
        Some((_, Ok(Some(path)))) if path.is_dir() => {
            return UserDirLookup {
                dir: Some(UserDir {
                    path,
                    source: UserDirSource::LauncherSettings,
                }),
                ignored: None,
            };
        }
        Some((value, Ok(Some(path)))) => Some(IgnoredGameDataPath::Missing {
            value: value.to_owned(),
            path,
        }),
        Some((_, Err(ignored))) => Some(ignored),
        Some((_, Ok(None))) | None => None,
    };
    UserDirLookup {
        dir: default.map(|path| UserDir {
            path,
            source: UserDirSource::Default,
        }),
        ignored,
    }
}

/// `value` with its leading token, in any letter case, replaced by the folder it stands for;
/// `Ok(None)` when this machine has no such folder. A value with no token is a full path as
/// written.
fn expand_game_data_path(value: &str) -> Result<Option<PathBuf>, IgnoredGameDataPath> {
    for (token, base) in GAME_DATA_PATH_TOKENS {
        let Some(rest) = value
            .get(..token.len())
            .filter(|lead| lead.eq_ignore_ascii_case(token))
            .map(|_| &value[token.len()..])
        else {
            continue;
        };
        if !rest.is_empty() && !rest.starts_with(['/', '\\']) {
            break;
        }
        return Ok(base().map(|base| {
            rest.split(['/', '\\'])
                .filter(|part| !part.is_empty())
                .fold(base, |path, part| path.join(part))
        }));
    }
    if value.starts_with(['%', '$']) {
        return Err(IgnoredGameDataPath::UnknownToken {
            value: value.to_owned(),
        });
    }
    let path = PathBuf::from(value);
    if path.is_relative() {
        return Err(IgnoredGameDataPath::Relative {
            value: value.to_owned(),
        });
    }
    Ok(Some(path))
}

/// Whether `dir` holds a playset or mods: `dlc_load.json` or a `mod/` folder.
pub fn holds_playset(dir: &Path) -> bool {
    dir.join("dlc_load.json").is_file() || dir.join("mod").is_dir()
}

/// Whether `dir` looks like a Stellaris user folder: it holds a playset, mods or saves.
pub fn is_user_dir(dir: &Path) -> bool {
    holds_playset(dir) || dir.join(SAVE_GAMES).is_dir()
}

/// The default user folder, whether or not it exists.
fn paradox_user_dir() -> Option<PathBuf> {
    let base = if cfg!(target_os = "linux") {
        dirs::data_dir()
    } else {
        dirs::document_dir()
    };
    base.map(|b| b.join("Paradox Interactive").join("Stellaris"))
}

/// Steam Cloud save directories that exist on this machine, one per Steam account.
/// Steam may overwrite a file under these with its cloud copy.
pub fn find_cloud_save_dirs() -> Vec<PathBuf> {
    cloud_dirs_under(&steam_roots())
}

/// `userdata/<account>/281990/remote/save games` under each Steam install in `roots`.
pub fn cloud_dirs_under(roots: &[PathBuf]) -> Vec<PathBuf> {
    const TAIL: [&str; 3] = [STELLARIS_APP_ID, "remote", SAVE_GAMES];
    roots
        .iter()
        .flat_map(|root| {
            fs::read_dir(root.join("userdata"))
                .into_iter()
                .flatten()
                .flatten()
        })
        .map(|account| TAIL.iter().fold(account.path(), |p, part| p.join(part)))
        .filter(|p| p.is_dir())
        .collect()
}

/// Whether `path` lies under a Steam Cloud save directory of this machine.
pub fn is_cloud_save(path: &Path) -> bool {
    is_cloud_save_in(path, &find_cloud_save_dirs())
}

/// Whether `path` lies under one of `cloud_dirs`. Paths are canonicalised when they exist
/// (the file's parent suffices for a file not written yet), otherwise compared as given.
pub fn is_cloud_save_in(path: &Path, cloud_dirs: &[PathBuf]) -> bool {
    cloud_dirs
        .iter()
        .any(|dir| match (canonical(path), fs::canonicalize(dir)) {
            (Some(p), Ok(d)) => p.starts_with(d),
            _ => path.starts_with(dir),
        })
}

/// Steam installs this machine may have: `STEAM_PATH`, then the platform defaults.
pub fn steam_roots() -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = std::env::var_os("STEAM_PATH")
        .map(PathBuf::from)
        .into_iter()
        .collect();
    if cfg!(windows) {
        roots.extend(
            ["ProgramFiles(x86)", "ProgramFiles"]
                .iter()
                .filter_map(std::env::var_os)
                .map(|dir| PathBuf::from(dir).join("Steam")),
        );
    } else if cfg!(target_os = "macos") {
        roots.extend(dirs::home_dir().map(|h| h.join("Library/Application Support/Steam")));
    } else {
        roots.extend(
            dirs::home_dir()
                .into_iter()
                .flat_map(|h| [h.join(".steam/steam"), h.join(".local/share/Steam")]),
        );
    }
    roots
}

fn canonical(path: &Path) -> Option<PathBuf> {
    fs::canonicalize(path).ok().or_else(|| {
        let parent = fs::canonicalize(path.parent()?).ok()?;
        Some(parent.join(path.file_name()?))
    })
}
