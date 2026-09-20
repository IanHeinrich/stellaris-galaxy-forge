//! `.sav` container I/O: a zip with two deflated members, `gamestate` then `meta`.

use std::fs::{self, File};
use std::io::{self, BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tempfile::NamedTempFile;
use time::OffsetDateTime;
use time::macros::format_description;
use ts_rs::TS;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, DateTime, ZipArchive, ZipWriter};

use crate::cst;
use crate::scan::{self, ScanError, Value};

/// How often write progress is reported, in bytes.
const STEP: usize = 1 << 20;

/// The sink a writer body pours the document's pieces into.
type Sink<'w> = dyn FnMut(&mut dyn Write) -> Result<(), Error> + 'w;

/// The two members of a `.sav`, inflated.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RawSave {
    pub gamestate: Vec<u8>,
    pub meta: Vec<u8>,
}

/// The header scalars a save list needs, read from `meta`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SaveMeta {
    /// Empire name as written by the game (may be a localisation key).
    pub name: String,
    /// In-game date, `"2206.11.16"`.
    pub date: String,
    /// Game version, `"Pegasus v4.4.6"`.
    pub version: String,
    /// `ironman=yes`, which only an ironman save carries.
    pub ironman: bool,
    /// `meta_planets`.
    pub planets: Option<u32>,
    /// `meta_fleets`.
    pub fleets: Option<u32>,
    /// The first entry of `flag.colors`, the empire's primary colour key.
    pub color: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: io::Error,
    },
    #[error("{path}: {source}")]
    Zip {
        path: PathBuf,
        #[source]
        source: zip::result::ZipError,
    },
    #[error("{path}: archive has no `{member}` member")]
    MissingMember { path: PathBuf, member: &'static str },
    #[error("{path}: could not write the new save ({source}); the original is at {backup}")]
    Stranded {
        path: PathBuf,
        backup: PathBuf,
        #[source]
        source: io::Error,
    },
    #[error("meta: {0}")]
    Meta(#[from] ScanError),
    #[error("meta: `{0}` is missing or not a scalar")]
    MetaField(&'static str),
}

/// Read and inflate both members of a `.sav`.
pub fn read_sav(path: impl AsRef<Path>) -> Result<RawSave, Error> {
    let path = path.as_ref();
    let mut archive = open(path)?;
    let gamestate = read_member(&mut archive, path, "gamestate")?;
    let meta = read_member(&mut archive, path, "meta")?;
    Ok(RawSave { gamestate, meta })
}

/// Read only `meta` and parse its header scalars (for listing saves without inflating `gamestate`).
pub fn read_meta_only(path: impl AsRef<Path>) -> Result<SaveMeta, Error> {
    let path = path.as_ref();
    let mut archive = open(path)?;
    let meta = read_member(&mut archive, path, "meta")?;
    parse_meta(&meta)
}

/// Parse the header scalars from the bytes of a `meta` member.
pub fn parse_meta(meta: &[u8]) -> Result<SaveMeta, Error> {
    let index = scan::scan(meta)?;
    let optional = |key: &str| -> Option<String> {
        match index.section(key).map(|s| &s.value) {
            Some(Value::Scalar(span)) => {
                Some(String::from_utf8_lossy(scan::unquote(span.slice(meta))).into_owned())
            }
            _ => None,
        }
    };
    let scalar = |key: &'static str| optional(key).ok_or(Error::MetaField(key));
    Ok(SaveMeta {
        name: scalar("name")?,
        date: scalar("date")?,
        version: scalar("version")?,
        ironman: optional("ironman").is_some_and(|v| v == "yes"),
        planets: optional("meta_planets").and_then(|v| v.parse().ok()),
        fleets: optional("meta_fleets").and_then(|v| v.parse().ok()),
        color: flag_color(meta, &index),
    })
}

/// The first entry of `flag={ colors={ "blue" … } }`; the list holds bare items, which the
/// span index does not record, so the block is re-read as a tree.
fn flag_color(meta: &[u8], index: &scan::Index) -> Option<String> {
    let Value::Block { open, close } = index.section("flag")?.value else {
        return None;
    };
    let flag = cst::parse(&meta[open..=close], open).ok()?;
    let colors = flag.children().first()?.find("colors", meta)?;
    colors
        .children()
        .first()?
        .scalar_str(meta)
        .map(str::to_owned)
}

/// Write a `.sav` from `pieces` (concatenated into `gamestate`) and `meta`.
///
/// The archive is built in a temp file beside `path`; an existing file at `path` is renamed to
/// `<file name>.bak-YYYYmmdd-HHMMSS` before the temp file is persisted. Returns the backup path.
pub fn write_sav<'a>(
    path: impl AsRef<Path>,
    pieces: impl Iterator<Item = &'a [u8]>,
    meta: &[u8],
) -> Result<Option<PathBuf>, Error> {
    write_sav_with(path, pieces, meta, |_| {})
}

/// [`write_sav`], reporting the fraction of `gamestate` bytes written about once per
/// megabyte and `1.0` once the archive is complete.
pub fn write_sav_with<'a>(
    path: impl AsRef<Path>,
    pieces: impl Iterator<Item = &'a [u8]>,
    meta: &[u8],
    progress: impl FnMut(f64),
) -> Result<Option<PathBuf>, Error> {
    let path = path.as_ref();
    streamed(path, pieces, progress, |file, gamestate| {
        let mut zip = ZipWriter::new(BufWriter::new(file));
        let options = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Deflated)
            .last_modified_time(DateTime::default());
        zip.start_file("gamestate", options)
            .map_err(|source| zip_err(path, source))?;
        gamestate(&mut zip)?;
        zip.start_file("meta", options)
            .map_err(|source| zip_err(path, source))?;
        zip.write_all(meta).map_err(|source| io_err(path, source))?;
        let mut out = zip.finish().map_err(|source| zip_err(path, source))?;
        out.flush().map_err(|source| io_err(path, source))
    })
}

/// Write a scenario script from `pieces` as plain text.
///
/// The text is built in a temp file beside `path` and persisted under the same backup rule
/// as [`write_sav_with`]. Returns the backup path.
pub fn write_text_with<'a>(
    path: impl AsRef<Path>,
    pieces: impl Iterator<Item = &'a [u8]>,
    progress: impl FnMut(f64),
) -> Result<Option<PathBuf>, Error> {
    let path = path.as_ref();
    streamed(path, pieces, progress, |file, text| {
        let mut out = BufWriter::new(file);
        text(&mut out)?;
        out.flush().map_err(|source| io_err(path, source))
    })
}

/// Build the file in a temp file beside `path` and persist it under the backup rule.
/// `body` wraps the temp file in whatever the format needs and calls the sink it is
/// handed to pour `pieces` in; the sink reports the fraction written about once per
/// megabyte, and `1.0` follows once `body` returns.
fn streamed<'a>(
    path: &Path,
    pieces: impl Iterator<Item = &'a [u8]>,
    mut progress: impl FnMut(f64),
    body: impl FnOnce(&File, &mut Sink<'_>) -> Result<(), Error>,
) -> Result<Option<PathBuf>, Error> {
    let pieces: Vec<&[u8]> = pieces.collect();
    let total: usize = pieces.iter().map(|p| p.len()).sum();
    let tmp = temp_beside(path)?;
    let mut written = 0usize;
    let mut reported = 0usize;
    let mut pour = |out: &mut dyn Write| -> Result<(), Error> {
        for chunk in pieces.iter().flat_map(|piece| piece.chunks(STEP)) {
            out.write_all(chunk)
                .map_err(|source| io_err(path, source))?;
            written += chunk.len();
            if written - reported >= STEP {
                reported = written;
                progress(written as f64 / total as f64);
            }
        }
        Ok(())
    };
    body(tmp.as_file(), &mut pour)?;
    progress(1.0);
    persist(path, tmp)
}

fn temp_beside(path: &Path) -> Result<NamedTempFile, Error> {
    let dir = match path.parent() {
        Some(p) if !p.as_os_str().is_empty() => p,
        _ => Path::new("."),
    };
    NamedTempFile::new_in(dir).map_err(|source| io_err(path, source))
}

/// Rename any file at `path` out of the way, then move `tmp` into its place.
fn persist(path: &Path, tmp: NamedTempFile) -> Result<Option<PathBuf>, Error> {
    let backup = if path.exists() {
        let backup = backup_path(path);
        fs::rename(path, &backup).map_err(|source| io_err(path, source))?;
        Some(backup)
    } else {
        None
    };
    if let Err(e) = tmp.persist(path) {
        if let Some(b) = &backup
            && fs::rename(b, path).is_err()
        {
            return Err(Error::Stranded {
                path: path.to_path_buf(),
                backup: b.clone(),
                source: e.error,
            });
        }
        return Err(io_err(path, e.error));
    }
    Ok(backup)
}

fn open(path: &Path) -> Result<ZipArchive<BufReader<File>>, Error> {
    let file = File::open(path).map_err(|source| io_err(path, source))?;
    ZipArchive::new(BufReader::new(file)).map_err(|source| zip_err(path, source))
}

fn read_member(
    archive: &mut ZipArchive<BufReader<File>>,
    path: &Path,
    member: &'static str,
) -> Result<Vec<u8>, Error> {
    let mut entry = match archive.by_name(member) {
        Ok(entry) => entry,
        Err(zip::result::ZipError::FileNotFound) => {
            return Err(Error::MissingMember {
                path: path.to_path_buf(),
                member,
            });
        }
        Err(source) => return Err(zip_err(path, source)),
    };
    let mut buf = Vec::with_capacity(usize::try_from(entry.size()).unwrap_or(0));
    entry
        .read_to_end(&mut buf)
        .map_err(|source| io_err(path, source))?;
    Ok(buf)
}

fn backup_path(path: &Path) -> PathBuf {
    let now = OffsetDateTime::now_local().unwrap_or_else(|_| OffsetDateTime::now_utc());
    let stamp = now
        .format(format_description!(
            "[year][month][day]-[hour][minute][second]"
        ))
        .unwrap_or_else(|_| "unknown".to_owned());
    let base = path.file_name().map(|n| n.to_owned()).unwrap_or_default();
    // Never reuse a backup name: a second save in the same second must not
    // overwrite the only copy of the original.
    let mut n = 0u32;
    loop {
        let mut name = base.clone();
        name.push(format!(".bak-{stamp}"));
        if n > 0 {
            name.push(format!("-{n}"));
        }
        let candidate = path.with_file_name(name);
        if !candidate.exists() {
            return candidate;
        }
        n += 1;
    }
}

fn io_err(path: &Path, source: io::Error) -> Error {
    Error::Io {
        path: path.to_path_buf(),
        source,
    }
}

fn zip_err(path: &Path, source: zip::result::ZipError) -> Error {
    Error::Zip {
        path: path.to_path_buf(),
        source,
    }
}
