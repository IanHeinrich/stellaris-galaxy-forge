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
                match take_number(&mut a).cmp(&take_number(&mut b)) {
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

fn take_number(chars: &mut std::iter::Peekable<std::str::Chars>) -> u64 {
    let mut n: u64 = 0;
    while let Some(c) = chars.peek().filter(|c| c.is_ascii_digit()) {
        n = n * 10 + c.to_digit(10).expect("ascii digit") as u64;
        chars.next();
    }
    n
}
