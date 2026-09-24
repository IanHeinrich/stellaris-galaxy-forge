use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use crate::changelog::{self, Version};
use crate::local::{LocalFiles, Repo, image_extension};
use crate::plan::{self, Page, Plan};
use crate::state::UploadedState;
use crate::steam::{LiveItem, Steam, Submitted, Update};

const LEGAL_AGREEMENT_URL: &str = "https://steamcommunity.com/sharedfiles/workshoplegalagreement";
const LARGE_EMBEDDED_IMAGE_BYTES: u64 = 5 * 1024 * 1024;

pub fn pull(repo: &Repo, item: u64, force: bool) -> Result<(), String> {
    let live = Steam::connect()?.fetch_item(item)?;
    let pulled = download_page(repo, &live)?;
    let stale = stale_files(repo, &live, &pulled)?;

    let conflicts: Vec<String> = pulled
        .iter()
        .filter(|file| file.differs_from_disk())
        .map(|file| &file.path)
        .chain(&stale)
        .filter(|path| path.exists())
        .map(|path| shown(repo, path))
        .collect();
    if !force && !conflicts.is_empty() {
        return Err(format!(
            "pull would change or remove {}; pass --force to replace them",
            conflicts.join(", ")
        ));
    }

    for path in &stale {
        remove(path)?;
        println!("removed {}", shown(repo, path));
    }
    let dir = repo.carousel_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    for file in &pulled {
        if file.differs_from_disk() {
            write(&file.path, &file.bytes)?;
            println!("wrote {}", shown(repo, &file.path));
        } else {
            println!("unchanged {}", shown(repo, &file.path));
        }
    }
    if live.preview_url.is_none() {
        println!("the item has no main preview");
    }
    let skipped = live.previews.iter().filter(|p| !p.is_image).count();
    if skipped > 0 {
        println!("skipped {skipped} video preview(s)");
    }
    Ok(())
}

struct PulledFile {
    path: PathBuf,
    bytes: Vec<u8>,
    is_description: bool,
}

impl PulledFile {
    fn differs_from_disk(&self) -> bool {
        match fs::read(&self.path) {
            Ok(existing) if self.is_description => {
                plan::normalise(&String::from_utf8_lossy(&existing))
                    != plan::normalise(&String::from_utf8_lossy(&self.bytes))
            }
            Ok(existing) => existing != self.bytes,
            Err(_) => true,
        }
    }
}

fn download_page(repo: &Repo, live: &LiveItem) -> Result<Vec<PulledFile>, String> {
    let mut pulled = vec![PulledFile {
        path: repo.description_path(),
        bytes: live.description.replace("\r\n", "\n").into_bytes(),
        is_description: true,
    }];
    if let Some(url) = &live.preview_url {
        let (bytes, extension) = download_image(url, "the main preview")?;
        pulled.push(PulledFile {
            path: repo.workshop().join(format!("preview.{extension}")),
            bytes,
            is_description: false,
        });
    }
    let images = live.previews.iter().filter(|preview| preview.is_image);
    for (number, preview) in (1..).zip(images) {
        let (bytes, extension) = download_image(&preview.url, &format!("carousel image {number}"))?;
        pulled.push(PulledFile {
            path: repo
                .carousel_dir()
                .join(format!("{number:02}-preview.{extension}")),
            bytes,
            is_description: false,
        });
    }
    Ok(pulled)
}

fn stale_files(
    repo: &Repo,
    live: &LiveItem,
    pulled: &[PulledFile],
) -> Result<Vec<PathBuf>, String> {
    let mut local = repo.carousel()?;
    if live.preview_url.is_some() {
        local.extend(repo.previews()?);
    }
    Ok(local
        .into_iter()
        .filter(|path| pulled.iter().all(|file| &file.path != path))
        .collect())
}

pub fn init(repo: &Repo, item: u64, force: bool) -> Result<(), String> {
    let files = LocalFiles::read(repo)?;
    files.validate()?;
    let state = files.state(&repo.version()?)?;

    let steam = Steam::connect()?;
    if let Some(existing) = steam.fetch_item(item)?.metadata
        && !force
    {
        return Err(format!(
            "the item already has metadata ({existing}); pass --force to replace it"
        ));
    }
    let metadata = state.to_json();
    println!("metadata: {metadata}");
    let update = Update {
        metadata,
        ..Update::default()
    };
    report(steam.submit(item, &update)?)
}

pub fn push(repo: &Repo, item: u64, mode: PushMode, force: bool) -> Result<(), String> {
    let files = LocalFiles::read(repo)?;
    files.validate()?;
    check_embedded_images(&files.description)?;
    let local_state = files.state(&repo.version()?)?;

    let steam = Steam::connect()?;
    let live = steam.fetch_item(item)?;
    let metadata = live
        .metadata
        .as_deref()
        .ok_or("the item has no upload state in its metadata; run `init` first")?;
    let live_state = UploadedState::from_json(metadata)?;

    let plan = plan::plan(
        &Page {
            description: &live.description,
            state: &live_state,
        },
        &Page {
            description: &files.description,
            state: &local_state,
        },
        force,
    )?;
    let change_note = match plan.version_moved {
        Some((since, current)) => Some(changelog::change_note(&repo.changelog()?, since, current)?),
        None => None,
    };
    print_decisions(&plan, &live, &files);

    if plan.is_empty() {
        println!("Nothing to upload");
        return Ok(());
    }
    match &change_note {
        Some(note) => println!("change note:\n{note}"),
        None => println!("change note: none"),
    }
    match mode {
        PushMode::DryRun => {
            println!("Dry run: nothing submitted");
            return Ok(());
        }
        PushMode::Ask if !confirm("Upload these changes to the Workshop?")? => {
            println!("Nothing submitted");
            return Ok(());
        }
        _ => {}
    }
    let update = update_for(&plan, &live, &files, change_note);
    report(steam.submit(item, &update)?)
}

/// Posts one change note per released version from `from` up to the version
/// the item's metadata records, oldest first, so Steam lists them newest on top.
pub fn backfill(repo: &Repo, item: u64, from: Version, mode: PushMode) -> Result<(), String> {
    let changelog = repo.changelog()?;
    let steam = Steam::connect()?;
    let metadata = steam
        .fetch_item(item)?
        .metadata
        .ok_or("the item has no upload state in its metadata; run `init` first")?;
    let recorded = UploadedState::from_json(&metadata)?.version;
    let to = Version::parse(&recorded)
        .ok_or_else(|| format!("the metadata version {recorded:?} is not x.y.z"))?;

    let versions = changelog::versions_between(&changelog, from, to);
    if versions.is_empty() {
        println!("No released versions from {from} to {to}");
        return Ok(());
    }
    let notes = versions
        .iter()
        .map(|&version| changelog::version_note(&changelog, version))
        .collect::<Result<Vec<_>, _>>()?;
    for (i, note) in notes.iter().enumerate() {
        println!("change note {} of {}:\n{note}\n", i + 1, notes.len());
    }
    match mode {
        PushMode::DryRun => {
            println!("Dry run: nothing submitted");
            return Ok(());
        }
        PushMode::Ask if !confirm(&format!("Post these {} change notes?", notes.len()))? => {
            println!("Nothing submitted");
            return Ok(());
        }
        _ => {}
    }
    for (version, note) in versions.iter().zip(notes) {
        println!("{version}:");
        let update = Update {
            metadata: metadata.clone(),
            change_note: Some(note),
            ..Update::default()
        };
        report(steam.submit(item, &update)?)?;
    }
    Ok(())
}

#[derive(Clone, Copy)]
pub enum PushMode {
    Ask,
    Yes,
    DryRun,
}

fn confirm(question: &str) -> Result<bool, String> {
    print!("{question} [y/N] ");
    io::stdout().flush().map_err(|e| e.to_string())?;
    let mut answer = String::new();
    io::stdin()
        .read_line(&mut answer)
        .map_err(|e| format!("cannot read the answer: {e}"))?;
    Ok(matches!(answer.trim(), "y" | "Y" | "yes"))
}

fn update_for(
    plan: &Plan,
    live: &LiveItem,
    files: &LocalFiles,
    change_note: Option<String>,
) -> Update {
    let mut update = Update {
        description: plan.description.then(|| files.description.clone()),
        preview: plan.preview.then(|| files.preview.clone()),
        metadata: plan.new_state.to_json(),
        change_note,
        ..Update::default()
    };
    if plan.carousel {
        update.remove_previews = live_image_indices(live);
        update.remove_previews.reverse();
        update.add_previews = files.carousel.clone();
    }
    update
}

fn live_image_indices(live: &LiveItem) -> Vec<u32> {
    let mut indices: Vec<u32> = live
        .previews
        .iter()
        .filter(|preview| preview.is_image)
        .map(|preview| preview.index)
        .collect();
    indices.sort_unstable();
    indices
}

fn print_decisions(plan: &Plan, live: &LiveItem, files: &LocalFiles) {
    println!(
        "description: {}",
        if plan.description {
            "upload"
        } else {
            "unchanged"
        }
    );
    println!(
        "preview: {}",
        if plan.preview { "upload" } else { "unchanged" }
    );
    if plan.carousel {
        println!(
            "carousel: remove {} live image(s), add {} local image(s)",
            live_image_indices(live).len(),
            files.carousel.len()
        );
    } else {
        println!("carousel: unchanged");
    }
    match plan.version_moved {
        Some((since, current)) => println!("version: {since} -> {current}"),
        None => println!("version: unchanged ({})", plan.new_state.version),
    }
}

fn report(submitted: Submitted) -> Result<(), String> {
    let ok = submitted.is_ok();
    let outcome = if ok { " (OK)" } else { "" };
    println!("Steam answered EResult {}{outcome}", submitted.result);
    if submitted.needs_legal_agreement {
        println!(
            "Accept the Workshop legal agreement before the page shows: {LEGAL_AGREEMENT_URL}"
        );
    }
    if !ok {
        return Err(format!("the update failed: EResult {}", submitted.result));
    }
    Ok(())
}

fn check_embedded_images(description: &str) -> Result<(), String> {
    for url in plan::embedded_images(description) {
        let response = ureq::head(url)
            .call()
            .map_err(|e| format!("embedded image {url} did not load: {e}"))?;
        let status = response.status().as_u16();
        let header = |name: &str| {
            response
                .headers()
                .get(name)
                .and_then(|value| value.to_str().ok())
                .map(str::to_string)
        };
        let content_type = header("content-type").unwrap_or_default();
        if status != 200 || !content_type.starts_with("image/") {
            return Err(format!(
                "embedded image {url} answered {status} with content type {content_type:?}"
            ));
        }
        let size = header("content-length").and_then(|value| value.parse::<u64>().ok());
        if let Some(size) = size.filter(|&size| size > LARGE_EMBEDDED_IMAGE_BYTES) {
            println!("warning: embedded image {url} is {size} bytes, over 5 MB");
        }
    }
    Ok(())
}

fn download_image(url: &str, what: &str) -> Result<(Vec<u8>, &'static str), String> {
    let bytes = ureq::get(url)
        .call()
        .and_then(|response| response.into_body().read_to_vec())
        .map_err(|e| format!("cannot download {what} ({url}): {e}"))?;
    let extension = image_extension(&bytes).ok_or_else(|| {
        format!("{what} ({url}) is not a PNG, JPEG or GIF image, so push could not upload it back")
    })?;
    Ok((bytes, extension))
}

fn write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    fs::write(path, bytes).map_err(|e| format!("cannot write {}: {e}", path.display()))
}

fn remove(path: &Path) -> Result<(), String> {
    fs::remove_file(path).map_err(|e| format!("cannot remove {}: {e}", path.display()))
}

fn shown(repo: &Repo, path: &Path) -> String {
    path.strip_prefix(&repo.root)
        .unwrap_or(path)
        .display()
        .to_string()
        .replace('\\', "/")
}
