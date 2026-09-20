//! What an Open screen lists as saves: where this machine keeps them, and what stands in
//! each campaign folder. Reading a `.sav` itself is [`crate::archive`]'s job; this only
//! finds the files and opens as few of them as a listing needs.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::archive::{SaveMeta, read_meta_only};

/// Stellaris on Steam, which names its Steam Cloud directory.
const STELLARIS_APP_ID: &str = "281990";

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

/// A campaign folder as a save list shows it before its saves are read: how many it
/// holds, when it was last written, and the header of its newest save (one archive
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
    pub files: u32,
    /// Newest save's modification, seconds since the Unix epoch.
    #[ts(type = "number")]
    pub newest: i64,
    /// Read from the newest save only; `None` when that archive could not be read.
    pub meta: Option<SaveMeta>,
    /// See [`SaveFile::cloud`].
    pub cloud: bool,
}

/// Stellaris save directories that exist on this machine.
pub fn find_save_dirs() -> Vec<PathBuf> {
    paradox_user_dir()
        .map(|dir| dir.join("save games"))
        .filter(|p| p.is_dir())
        .into_iter()
        .collect()
}

/// This machine's save directories: the local ones, then the Steam Cloud ones.
pub fn save_roots() -> Vec<(PathBuf, bool)> {
    find_save_dirs()
        .into_iter()
        .map(|d| (d, false))
        .chain(find_cloud_save_dirs().into_iter().map(|d| (d, true)))
        .collect()
}

/// Every `.sav` under this machine's save directories, local and Steam Cloud, newest
/// first. A campaign folder names the saves under it; an unreadable archive is listed
/// without its meta.
pub fn list_saves() -> Vec<SaveFile> {
    list_saves_in(&save_roots())
}

/// Every `.sav` directly under each of `roots` and under its campaign folders, newest
/// first; the flag beside a root marks it as a Steam Cloud directory.
pub fn list_saves_in(roots: &[(PathBuf, bool)]) -> Vec<SaveFile> {
    let mut saves = Vec::new();
    for (dir, cloud) in roots {
        collect_saves(dir, "", *cloud, &mut saves);
        for campaign in subdirs(dir) {
            collect_saves(&campaign, &dir_name(&campaign), *cloud, &mut saves);
        }
    }
    sort_newest_first(&mut saves);
    saves
}

/// Every campaign folder under this machine's save directories, newest first.
pub fn list_campaigns() -> Vec<CampaignListing> {
    list_campaigns_in(&save_roots())
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
    let entries = sav_entries(dir);
    let newest = entries.iter().max_by(|a, b| {
        a.modified
            .cmp(&b.modified)
            .then_with(|| b.path.cmp(&a.path))
    })?;
    let meta = read_meta_only(&newest.path).ok();
    Some(CampaignListing {
        dir: dir.to_string_lossy().into_owned(),
        name: dir_name(dir),
        empire: meta.as_ref().map(|m| m.name.clone()),
        files: crate::as_u32(entries.len()),
        newest: newest.modified,
        meta,
        cloud,
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

/// The launcher's user data directory (`Documents/Paradox Interactive/Stellaris`, or
/// `~/.local/share/Paradox Interactive/Stellaris` on Linux), whether or not it exists.
pub fn paradox_user_dir() -> Option<PathBuf> {
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
    const TAIL: [&str; 3] = [STELLARIS_APP_ID, "remote", "save games"];
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
