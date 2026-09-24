use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::changelog::Version;
use crate::local::{Repo, image_extension};

const DESCRIPTOR: &str = "descriptor.mod";
const THUMBNAIL: &str = "thumbnail.png";

/// The item's content: `workshop/content/` with the descriptor's version set
/// per upload, and the main preview as `thumbnail.png`.
pub struct Content {
    descriptor: String,
    thumbnail: PathBuf,
    others: Vec<(PathBuf, PathBuf)>,
}

impl Content {
    pub fn read(repo: &Repo, preview: &Path) -> Result<Content, String> {
        let dir = repo.content_dir();
        let descriptor_path = dir.join(DESCRIPTOR);
        let descriptor = fs::read_to_string(&descriptor_path)
            .map_err(|e| format!("cannot read {}: {e}", descriptor_path.display()))?;
        check_version_line(&descriptor)?;

        let bytes =
            fs::read(preview).map_err(|e| format!("cannot read {}: {e}", preview.display()))?;
        if image_extension(&bytes) != Some("png") {
            return Err(format!(
                "{} is not a PNG, and the item's content needs it as {THUMBNAIL}",
                preview.display()
            ));
        }

        let mut others = Vec::new();
        list_files(&dir, &dir, &mut others)?;
        others.retain(|(relative, _)| relative != Path::new(DESCRIPTOR));
        if others
            .iter()
            .any(|(relative, _)| relative == Path::new(THUMBNAIL))
        {
            return Err(format!(
                "workshop/content/{THUMBNAIL} would clash with the preview uploaded under that name"
            ));
        }
        Ok(Content {
            descriptor,
            thumbnail: preview.to_path_buf(),
            others,
        })
    }

    pub fn describe(version: Version) -> String {
        format!("content: descriptor version {version} + thumbnail")
    }

    /// Writes the content for `version` into a new folder under the temp
    /// directory, removed when the returned value is dropped.
    pub fn stage(&self, version: Version) -> Result<StagedContent, String> {
        let staged = StagedContent::create(version)?;
        let dir = &staged.dir;
        write(
            &dir.join(DESCRIPTOR),
            set_descriptor_version(&self.descriptor, version)?.as_bytes(),
        )?;
        copy(&self.thumbnail, &dir.join(THUMBNAIL))?;
        for (relative, source) in &self.others {
            let target = dir.join(relative);
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("cannot create {}: {e}", parent.display()))?;
            }
            copy(source, &target)?;
        }
        Ok(staged)
    }
}

pub struct StagedContent {
    pub dir: PathBuf,
}

impl StagedContent {
    fn create(version: Version) -> Result<StagedContent, String> {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |elapsed| elapsed.as_nanos());
        let name = format!(
            "sgf-workshop-content-{}-{version}-{nanos}",
            std::process::id()
        );
        let dir = std::env::temp_dir().join(name);
        fs::create_dir(&dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
        Ok(StagedContent { dir })
    }
}

impl Drop for StagedContent {
    fn drop(&mut self) {
        if let Err(e) = fs::remove_dir_all(&self.dir) {
            eprintln!("warning: cannot remove {}: {e}", self.dir.display());
        }
    }
}

/// The descriptor with its `version="..."` line set to `version`; every
/// other byte is kept.
pub fn set_descriptor_version(descriptor: &str, version: Version) -> Result<String, String> {
    check_version_line(descriptor)?;
    Ok(descriptor
        .split_inclusive('\n')
        .map(|line| {
            if !is_version_line(line) {
                return line.to_string();
            }
            let indent = &line[..line.len() - line.trim_start().len()];
            let ending = &line[line.trim_end_matches(['\r', '\n']).len()..];
            format!("{indent}version=\"{version}\"{ending}")
        })
        .collect())
}

fn check_version_line(descriptor: &str) -> Result<(), String> {
    match descriptor
        .split_inclusive('\n')
        .filter(|line| is_version_line(line))
        .count()
    {
        1 => Ok(()),
        0 => Err(format!("{DESCRIPTOR} has no version=\"...\" line")),
        _ => Err(format!("{DESCRIPTOR} has more than one version line")),
    }
}

fn is_version_line(line: &str) -> bool {
    line.trim_start()
        .strip_prefix("version")
        .is_some_and(|rest| rest.trim_start().starts_with('='))
}

fn list_files(base: &Path, dir: &Path, out: &mut Vec<(PathBuf, PathBuf)>) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|e| format!("cannot list {}: {e}", dir.display()))?;
    for entry in entries {
        let path = entry
            .map_err(|e| format!("cannot list {}: {e}", dir.display()))?
            .path();
        if path.is_dir() {
            list_files(base, &path, out)?;
        } else {
            let relative = path.strip_prefix(base).expect("under base").to_path_buf();
            out.push((relative, path));
        }
    }
    Ok(())
}

fn write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    fs::write(path, bytes).map_err(|e| format!("cannot write {}: {e}", path.display()))
}

fn copy(from: &Path, to: &Path) -> Result<(), String> {
    fs::copy(from, to)
        .map(|_| ())
        .map_err(|e| format!("cannot copy {} to {}: {e}", from.display(), to.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    const SEEDED: &str = "version=\"0.6.0\"\ntags={\n\t\"Galaxy Generation\"\n}\nname=\"Stellaris Galaxy Forge\"\nsupported_version=\"v4.4.6\"\nremote_file_id=\"3805578137\"";

    fn v(text: &str) -> Version {
        Version::parse(text).unwrap()
    }

    #[test]
    fn replaces_only_the_version_line() {
        let rewritten = set_descriptor_version(SEEDED, v("0.12.0")).unwrap();
        assert_eq!(
            rewritten,
            SEEDED.replacen("version=\"0.6.0\"", "version=\"0.12.0\"", 1)
        );
        assert!(rewritten.contains("supported_version=\"v4.4.6\""));
    }

    #[test]
    fn keeps_line_endings_indentation_and_spacing_elsewhere() {
        let descriptor = "name=\"A\"\r\n  version = \"1.0.0\"\r\nsupported_version=\"v4.*\"\r\n";
        let rewritten = set_descriptor_version(descriptor, v("2.0.0")).unwrap();
        assert_eq!(
            rewritten,
            "name=\"A\"\r\n  version=\"2.0.0\"\r\nsupported_version=\"v4.*\"\r\n"
        );
    }

    #[test]
    fn a_descriptor_without_a_version_line_is_an_error() {
        let error =
            set_descriptor_version("name=\"A\"\nsupported_version=\"v4.4.6\"\n", v("1.0.0"))
                .unwrap_err();
        assert_eq!(error, "descriptor.mod has no version=\"...\" line");
    }

    #[test]
    fn two_version_lines_are_an_error() {
        let error =
            set_descriptor_version("version=\"1\"\nversion=\"2\"\n", v("1.0.0")).unwrap_err();
        assert_eq!(error, "descriptor.mod has more than one version line");
    }
}
