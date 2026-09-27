//! `flags/<category>/*.dds`: the emblems a flag can use, one category per
//! subfolder of `flags/` (`backgrounds` excluded; each category's own
//! `small/` and `map/` size variants excluded too, since they are the same
//! emblems at other sizes, not choices of their own).
//! `flags/backgrounds/*.dds`: the plain backgrounds a flag can use.

use crate::install::layers::Layout;

const DIR: &str = "flags";
const BACKGROUNDS: &str = "backgrounds";
const EXT: &str = "dds";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FlagFile {
    /// The `.dds` file name, with extension (`flag_pointy_2.dds`).
    pub file: String,
    /// The mod this file is from; `None` for vanilla's.
    pub source: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EmblemCategory {
    pub name: String,
    /// Sorted naturally by file name where that reads as intended
    /// (`flag_pointy_2` before `flag_pointy_10`), alphabetically otherwise.
    pub files: Vec<FlagFile>,
}

#[derive(Debug, Default)]
pub struct Flags {
    /// Alphabetical by category name; a category with no `.dds` directly
    /// inside it is left out.
    pub emblems: Vec<EmblemCategory>,
    pub backgrounds: Vec<FlagFile>,
}

impl Flags {
    pub(crate) fn load(layout: &Layout) -> Self {
        let mut categories: Vec<String> = layout
            .subdirs_in(DIR)
            .into_iter()
            .filter(|name| name != BACKGROUNDS)
            .collect();
        categories.sort();
        let emblems = categories
            .into_iter()
            .filter_map(|name| {
                let files = files_in(layout, &format!("{DIR}/{name}"));
                (!files.is_empty()).then_some(EmblemCategory { name, files })
            })
            .collect();
        let backgrounds = files_in(layout, &format!("{DIR}/{BACKGROUNDS}"));
        Self {
            emblems,
            backgrounds,
        }
    }
}

fn files_in(layout: &Layout, rel_dir: &str) -> Vec<FlagFile> {
    let mut files: Vec<FlagFile> = layout
        .files_with_ext_in(rel_dir, EXT)
        .into_iter()
        .filter_map(|(path, source)| {
            path.file_name().map(|name| FlagFile {
                file: name.to_string_lossy().into_owned(),
                source,
            })
        })
        .collect();
    files.sort_by(|a, b| natural_cmp(&a.file, &b.file));
    files
}

/// Compares two names the way a person reads them: a run of digits compares
/// by value (`2` before `10`), everything else byte for byte.
fn natural_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    use std::cmp::Ordering;

    let mut a = a.chars().peekable();
    let mut b = b.chars().peekable();
    loop {
        return match (a.peek().copied(), b.peek().copied()) {
            (None, None) => Ordering::Equal,
            (None, Some(_)) => Ordering::Less,
            (Some(_), None) => Ordering::Greater,
            (Some(ca), Some(cb)) if ca.is_ascii_digit() && cb.is_ascii_digit() => {
                let na = take_number(&mut a);
                let nb = take_number(&mut b);
                let (na, nb) = (na.trim_start_matches('0'), nb.trim_start_matches('0'));
                match na.len().cmp(&nb.len()).then_with(|| na.cmp(nb)) {
                    Ordering::Equal => continue,
                    other => other,
                }
            }
            (Some(ca), Some(cb)) => match ca.cmp(&cb) {
                Ordering::Equal => {
                    a.next();
                    b.next();
                    continue;
                }
                other => other,
            },
        };
    }
}

/// The digits at the front of `chars`, as written: parsing them into a number would
/// overflow on a long enough run, and comparing them by length then lexically (once
/// leading zeros are stripped) reads the same as a numeric comparison would.
fn take_number(chars: &mut std::iter::Peekable<std::str::Chars>) -> String {
    let mut digits = String::new();
    while let Some(&c) = chars.peek().filter(|c| c.is_ascii_digit()) {
        digits.push(c);
        chars.next();
    }
    digits
}
