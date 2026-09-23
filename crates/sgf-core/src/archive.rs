//! `.sav` container I/O: a zip with two deflated members, `gamestate` then `meta`.

use std::fs::{self, File};
use std::io::{self, BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tempfile::NamedTempFile;
use ts_rs::TS;
use zip::read::ZipFile;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, DateTime, ZipArchive, ZipWriter};

use crate::backup;
use crate::cst::{self, CstError, Node};
use crate::keys;
use crate::projections::galaxy::FlagRef;
use crate::projections::read;
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
    /// `version_control_revision`.
    pub version_revision: Option<u32>,
    /// `required_dlcs`, as the game names each.
    pub required_dlcs: Vec<String>,
    /// `player_portrait`, the species portrait key.
    pub portrait: Option<String>,
    pub flag: Option<MetaFlag>,
}

/// The player empire's flag as `meta` states it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct MetaFlag {
    pub icon: Option<FlagRef>,
    pub background: Option<FlagRef>,
    /// Every `colors` entry in file order, `"null"` included.
    pub colors: Vec<String>,
    /// `use_map_color=yes`: the entries after the fourth are the map border and fill (4.5).
    pub use_map_color: bool,
}

/// The setup screen a save was started with, from the top-level `galaxy` block; a key an
/// older version does not write is `None`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct GalaxySettings {
    pub template: Option<String>,
    pub shape: Option<String>,
    pub num_empires: Option<u32>,
    pub num_advanced_empires: Option<u32>,
    pub num_fallen_empires: Option<u32>,
    pub num_marauder_empires: Option<u32>,
    pub num_nomad_empires: Option<u32>,
    pub habitability: Option<f64>,
    pub primitive: Option<f64>,
    pub resource_abundance: Option<f64>,
    pub num_gateways: Option<u32>,
    pub num_wormhole_pairs: Option<u32>,
    pub num_hyperlanes: Option<f64>,
    pub difficulty: Option<String>,
    pub scaling: Option<String>,
    pub crisis_type: Option<String>,
    /// `crises`, the crisis strength multiplier.
    pub crises: Option<f64>,
    pub mid_game_start: Option<u32>,
    pub end_game_start: Option<u32>,
    pub ironman: Option<bool>,
    pub core_radius: Option<f64>,
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
    #[error("{path}: the `galaxy` block: {source}")]
    Galaxy {
        path: PathBuf,
        #[source]
        source: CstError,
    },
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
    let flag = meta_flag(meta, &index);
    Ok(SaveMeta {
        name: scalar(keys::meta::NAME)?,
        date: scalar(keys::meta::DATE)?,
        version: scalar(keys::meta::VERSION)?,
        ironman: optional(keys::meta::IRONMAN).is_some_and(|v| v == "yes"),
        planets: optional(keys::meta::META_PLANETS).and_then(|v| v.parse().ok()),
        fleets: optional(keys::meta::META_FLEETS).and_then(|v| v.parse().ok()),
        color: flag.as_ref().and_then(|f| f.colors.first().cloned()),
        version_revision: optional(keys::VERSION_CONTROL_REVISION).and_then(|v| v.parse().ok()),
        required_dlcs: block(meta, &index, keys::REQUIRED_DLCS)
            .map(|dlcs| items(&dlcs, meta))
            .unwrap_or_default(),
        portrait: optional(keys::meta::PLAYER_PORTRAIT),
        flag,
    })
}

/// The top-level block `key={ … }` re-read as a tree: its list items are bare, which the
/// span index does not record.
fn block(meta: &[u8], index: &scan::Index, key: &str) -> Option<Node> {
    let Value::Block { open, close } = index.section(key)?.value else {
        return None;
    };
    let root = cst::parse(&meta[open..=close], open).ok()?;
    root.children().first().cloned()
}

/// The bare scalar items of a list block, in file order.
fn items(list: &Node, src: &[u8]) -> Vec<String> {
    list.children()
        .iter()
        .filter(|c| c.key.is_none())
        .filter_map(|c| c.scalar_str(src))
        .map(str::to_owned)
        .collect()
}

fn meta_flag(meta: &[u8], index: &scan::Index) -> Option<MetaFlag> {
    let flag = block(meta, index, keys::FLAG)?;
    let layer = |key| {
        let layer = flag.find(key, meta)?;
        Some(FlagRef {
            category: read::scalar(layer, keys::CATEGORY, meta)?.to_owned(),
            file: read::scalar(layer, keys::FILE, meta)?.to_owned(),
        })
    };
    Some(MetaFlag {
        icon: layer(keys::ICON),
        background: layer(keys::BACKGROUND),
        colors: flag
            .find(keys::COLORS, meta)
            .map(|colors| items(colors, meta))
            .unwrap_or_default(),
        use_map_color: read::scalar(&flag, keys::USE_MAP_COLOR, meta) == Some("yes"),
    })
}

/// The setup screen `path` was started with, inflating `gamestate` only as far as the end
/// of its top-level `galaxy` block; all `None` when the save holds none.
pub fn read_galaxy_settings(path: impl AsRef<Path>) -> Result<GalaxySettings, Error> {
    let path = path.as_ref();
    let mut archive = open(path)?;
    let entry = member(&mut archive, path, "gamestate")?;
    let Some(block) =
        top_level_block(entry, keys::GALAXY.as_bytes()).map_err(|source| io_err(path, source))?
    else {
        return Ok(GalaxySettings::default());
    };
    let root = cst::parse(&block, 0).map_err(|source| Error::Galaxy {
        path: path.to_path_buf(),
        source,
    })?;
    Ok(root
        .children()
        .first()
        .map(|galaxy| galaxy_settings(galaxy, &block))
        .unwrap_or_default())
}

fn galaxy_settings(galaxy: &Node, src: &[u8]) -> GalaxySettings {
    let text = |key| read::scalar(galaxy, key, src).map(str::to_owned);
    let number = |key| read::scalar(galaxy, key, src)?.parse().ok();
    let count = |key| read::scalar_u32(galaxy, key, src);
    GalaxySettings {
        template: text(keys::TEMPLATE),
        shape: text(keys::SHAPE),
        num_empires: count(keys::NUM_EMPIRES),
        num_advanced_empires: count(keys::NUM_ADVANCED_EMPIRES),
        num_fallen_empires: count(keys::NUM_FALLEN_EMPIRES),
        num_marauder_empires: count(keys::NUM_MARAUDER_EMPIRES),
        num_nomad_empires: count(keys::NUM_NOMAD_EMPIRES),
        habitability: number(keys::HABITABILITY),
        primitive: number(keys::PRIMITIVE),
        resource_abundance: number(keys::RESOURCE_ABUNDANCE),
        num_gateways: count(keys::NUM_GATEWAYS),
        num_wormhole_pairs: count(keys::NUM_WORMHOLE_PAIRS),
        num_hyperlanes: number(keys::NUM_HYPERLANES),
        difficulty: text(keys::DIFFICULTY),
        scaling: text(keys::SCALING),
        crisis_type: text(keys::CRISIS_TYPE),
        crises: number(keys::CRISES),
        mid_game_start: count(keys::MID_GAME_START),
        end_game_start: count(keys::END_GAME_START),
        ironman: read::scalar(galaxy, keys::IRONMAN, src).map(|v| v == "yes"),
        core_radius: number(keys::CORE_RADIUS),
    }
}

/// How far a depth-0 statement has got towards `key={`.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Seen {
    Nothing,
    Key,
    KeyEq,
}

/// The first depth-0 `key={ … }` in `reader`'s text, braces included, reading no further
/// than its closing brace; `None` when the text ends without one. Braces inside quotes do
/// not count.
fn top_level_block(mut reader: impl Read, key: &[u8]) -> io::Result<Option<Vec<u8>>> {
    let mut buf = vec![0u8; 1 << 16];
    let mut depth = 0usize;
    let mut quoted = false;
    let mut word: Vec<u8> = Vec::with_capacity(key.len() + 1);
    let mut seen = Seen::Nothing;
    let mut block: Option<Vec<u8>> = None;
    loop {
        let n = match reader.read(&mut buf) {
            Ok(0) => return Ok(None),
            Ok(n) => n,
            Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
            Err(e) => return Err(e),
        };
        let chunk = &buf[..n];
        let mut kept_from = 0;
        let mut i = 0;
        while i < n {
            if quoted {
                let Some(at) = memchr::memchr(b'"', &chunk[i..]) else {
                    break;
                };
                quoted = false;
                i += at + 1;
                continue;
            }
            if depth > 0 {
                let Some(at) = memchr::memchr3(b'{', b'}', b'"', &chunk[i..]) else {
                    break;
                };
                i += at;
                match chunk[i] {
                    b'{' => depth += 1,
                    b'}' => depth -= 1,
                    _ => quoted = true,
                }
                i += 1;
                if depth == 0
                    && let Some(block) = block.as_mut()
                {
                    block.extend_from_slice(&chunk[kept_from..i]);
                    return Ok(Some(std::mem::take(block)));
                }
                continue;
            }
            let b = chunk[i];
            i += 1;
            if !scan::is_separator(b) {
                if word.len() <= key.len() {
                    word.push(b);
                }
                continue;
            }
            if !word.is_empty() {
                seen = if word == key {
                    Seen::Key
                } else {
                    Seen::Nothing
                };
                word.clear();
            }
            seen = match (b, seen) {
                (b'=', Seen::Key) => Seen::KeyEq,
                (b'{', Seen::KeyEq) => {
                    block = Some(Vec::new());
                    kept_from = i - 1;
                    depth = 1;
                    Seen::Nothing
                }
                (b'{', _) => {
                    depth = 1;
                    Seen::Nothing
                }
                (b'"', _) => {
                    quoted = true;
                    Seen::Nothing
                }
                (b'=' | b'}', _) => Seen::Nothing,
                _ => seen,
            };
        }
        if let Some(block) = block.as_mut() {
            block.extend_from_slice(&chunk[kept_from..]);
        }
    }
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

/// Rename any file at `path` out of the way, then move `tmp` into its place. A `tmp` that
/// already matches the file byte for byte is dropped instead, leaving the file untouched.
fn persist(path: &Path, tmp: NamedTempFile) -> Result<Option<PathBuf>, Error> {
    if path.exists() && same_bytes(path, &tmp).unwrap_or(false) {
        return Ok(None);
    }
    let backup = if path.exists() {
        let backup = backup::path_for(path);
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
    if backup.is_some() {
        backup::prune(path);
    }
    Ok(backup)
}

fn same_bytes(path: &Path, tmp: &NamedTempFile) -> io::Result<bool> {
    let mut existing = File::open(path)?;
    let mut fresh = tmp.reopen()?;
    if existing.metadata()?.len() != fresh.metadata()?.len() {
        return Ok(false);
    }
    let mut left = vec![0u8; STEP];
    let mut right = vec![0u8; STEP];
    loop {
        let n = existing.read(&mut left)?;
        if n == 0 {
            return Ok(true);
        }
        fresh.read_exact(&mut right[..n])?;
        if left[..n] != right[..n] {
            return Ok(false);
        }
    }
}

fn open(path: &Path) -> Result<ZipArchive<BufReader<File>>, Error> {
    let file = File::open(path).map_err(|source| io_err(path, source))?;
    ZipArchive::new(BufReader::new(file)).map_err(|source| zip_err(path, source))
}

fn member<'a>(
    archive: &'a mut ZipArchive<BufReader<File>>,
    path: &Path,
    member: &'static str,
) -> Result<ZipFile<'a, BufReader<File>>, Error> {
    match archive.by_name(member) {
        Ok(entry) => Ok(entry),
        Err(zip::result::ZipError::FileNotFound) => Err(Error::MissingMember {
            path: path.to_path_buf(),
            member,
        }),
        Err(source) => Err(zip_err(path, source)),
    }
}

fn read_member(
    archive: &mut ZipArchive<BufReader<File>>,
    path: &Path,
    name: &'static str,
) -> Result<Vec<u8>, Error> {
    let mut entry = member(archive, path, name)?;
    let mut buf = Vec::with_capacity(usize::try_from(entry.size()).unwrap_or(0));
    entry
        .read_to_end(&mut buf)
        .map_err(|source| io_err(path, source))?;
    Ok(buf)
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

#[cfg(test)]
mod tests {
    use std::io::{self, Read};

    use super::top_level_block;

    /// Hands out one byte per read, so every state crosses a chunk boundary.
    struct Trickle<'a>(&'a [u8]);

    impl Read for Trickle<'_> {
        fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
            let Some((&first, rest)) = self.0.split_first() else {
                return Ok(0);
            };
            buf[0] = first;
            self.0 = rest;
            Ok(1)
        }
    }

    fn galaxy(text: &str) -> Option<String> {
        let whole = top_level_block(text.as_bytes(), b"galaxy").unwrap();
        let trickled = top_level_block(Trickle(text.as_bytes()), b"galaxy").unwrap();
        assert_eq!(whole, trickled, "{text}");
        whole.map(|block| String::from_utf8(block).unwrap())
    }

    #[test]
    fn the_block_is_found_past_quoted_braces_stray_braces_and_nested_keys() {
        let found = Some("{ x=1 }".to_owned());
        assert_eq!(galaxy("name=\"{galaxy={\" galaxy={ x=1 }"), found);
        assert_eq!(galaxy("} galaxy={ x=1 } galaxy={ y=2 }"), found);
        assert_eq!(galaxy("other={ galaxy={ y=2 } } galaxy={ x=1 }"), found);
        assert_eq!(galaxy("galaxy_size=1 galaxy={ x=1 }"), found);
        assert_eq!(
            galaxy("galaxy=\n{\n\tname=\"}\" x={ 1 }\n}\nrest={ }"),
            Some("{\n\tname=\"}\" x={ 1 }\n}".to_owned())
        );
        assert_eq!(galaxy("other={ galaxy={ y=2 } }"), None);
        assert_eq!(galaxy("galaxy={ x=1"), None);
    }
}
