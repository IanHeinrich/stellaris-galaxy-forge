use std::fs;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use crate::state::UploadedState;

// Steam reads the description back into a buffer of this size, NUL included.
const MAX_DESCRIPTION_BYTES: usize =
    steamworks::sys::k_cchPublishedDocumentDescriptionMax as usize - 1;
const MAX_IMAGE_BYTES: u64 = 1024 * 1024;
const IMAGE_EXTENSIONS: [&str; 4] = ["png", "jpg", "jpeg", "gif"];

pub struct Repo {
    pub root: PathBuf,
}

impl Repo {
    pub fn find() -> Result<Repo, String> {
        let start = std::env::current_dir().map_err(|e| format!("no current directory: {e}"))?;
        start
            .ancestors()
            .find(|dir| dir.join("VERSION").is_file() && dir.join("CHANGELOG.md").is_file())
            .map(|root| Repo {
                root: root.to_path_buf(),
            })
            .ok_or_else(|| {
                format!(
                    "no folder with VERSION and CHANGELOG.md above {}",
                    start.display()
                )
            })
    }

    pub fn version(&self) -> Result<String, String> {
        Ok(read_text(&self.root.join("VERSION"))?.trim().to_string())
    }

    pub fn changelog(&self) -> Result<String, String> {
        read_text(&self.root.join("CHANGELOG.md"))
    }

    pub fn workshop(&self) -> PathBuf {
        self.root.join("workshop")
    }

    pub fn description_path(&self) -> PathBuf {
        self.workshop().join("description.bbcode")
    }

    pub fn carousel_dir(&self) -> PathBuf {
        self.workshop().join("carousel")
    }

    pub fn previews(&self) -> Result<Vec<PathBuf>, String> {
        Ok(images_in(&self.workshop())?
            .into_iter()
            .filter(|path| path.file_stem().is_some_and(|stem| stem == "preview"))
            .collect())
    }

    pub fn carousel(&self) -> Result<Vec<PathBuf>, String> {
        let dir = self.carousel_dir();
        if !dir.exists() {
            return Ok(Vec::new());
        }
        images_in(&dir)
    }
}

/// The page as the local files describe it.
pub struct LocalFiles {
    pub description: String,
    pub preview: PathBuf,
    pub carousel: Vec<PathBuf>,
}

impl LocalFiles {
    pub fn read(repo: &Repo) -> Result<LocalFiles, String> {
        let description = read_text(&repo.description_path())?.replace("\r\n", "\n");
        let preview = match repo.previews()?.as_slice() {
            [one] => one.clone(),
            [] => return Err("workshop/ has no preview.png, preview.jpg or preview.gif".into()),
            _ => return Err("workshop/ has more than one preview image".into()),
        };
        let carousel = repo.carousel()?;
        Ok(LocalFiles {
            description,
            preview,
            carousel,
        })
    }

    pub fn state(&self, version: &str) -> Result<UploadedState, String> {
        Ok(UploadedState {
            version: version.to_string(),
            preview: sha256_file(&self.preview)?,
            carousel: self
                .carousel
                .iter()
                .map(|path| sha256_file(path))
                .collect::<Result<_, _>>()?,
        })
    }

    pub fn validate(&self) -> Result<(), String> {
        let bytes = self.description.len();
        if bytes > MAX_DESCRIPTION_BYTES {
            return Err(format!(
                "description.bbcode is {bytes} bytes in UTF-8, more than Steam's {MAX_DESCRIPTION_BYTES}"
            ));
        }
        std::iter::once(&self.preview)
            .chain(&self.carousel)
            .try_for_each(|path| validate_image(path))
    }
}

fn validate_image(path: &Path) -> Result<(), String> {
    let bytes = fs::read(path).map_err(|e| format!("cannot read {}: {e}", path.display()))?;
    if bytes.len() as u64 > MAX_IMAGE_BYTES {
        return Err(format!(
            "{} is {} bytes, more than Steam's 1 MB",
            path.display(),
            bytes.len()
        ));
    }
    if image_extension(&bytes).is_none() {
        return Err(format!(
            "{} is not a PNG, JPEG or GIF image",
            path.display()
        ));
    }
    Ok(())
}

pub fn image_extension(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("png")
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("jpg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("gif")
    } else {
        None
    }
}

fn images_in(dir: &Path) -> Result<Vec<PathBuf>, String> {
    let entries = fs::read_dir(dir).map_err(|e| format!("cannot list {}: {e}", dir.display()))?;
    let mut images: Vec<PathBuf> = entries
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| path.is_file() && has_image_extension(path))
        .collect();
    images.sort();
    Ok(images)
}

fn has_image_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| IMAGE_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()))
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|e| format!("cannot read {}: {e}", path.display()))?;
    Ok(format!("{:x}", Sha256::digest(&bytes)))
}

fn read_text(path: &Path) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| format!("cannot read {}: {e}", path.display()))
}
