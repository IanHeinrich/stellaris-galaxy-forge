//! Whether two paths are the same, or one is below the other. Windows and macOS file systems
//! ignore letter case, Linux's do not, and every comparison in the shell takes that from here.

use std::ffi::OsStr;
use std::path::Path;

/// Whether two names that differ only by letter case are the same name.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Case {
    Blind,
    Sensitive,
}

impl Case {
    /// The rule of the file system this machine's paths live on.
    pub const HERE: Self = if cfg!(any(windows, target_os = "macos")) {
        Self::Blind
    } else {
        Self::Sensitive
    };

    pub fn same_name(self, a: &OsStr, b: &OsStr) -> bool {
        a == b
            || (self == Self::Blind
                && a.to_string_lossy().to_lowercase() == b.to_string_lossy().to_lowercase())
    }

    /// `inner` is `outer` or below it, compared part by part as written.
    pub fn covers(self, outer: &Path, inner: &Path) -> bool {
        let mut inner = inner.components();
        outer.components().all(|part| {
            inner
                .next()
                .is_some_and(|other| self.same_name(part.as_os_str(), other.as_os_str()))
        })
    }
}

/// `a` and `b` are one file, by where each really is when both exist and as written otherwise.
pub fn same_file(a: &Path, b: &Path) -> bool {
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(a), Ok(b)) => Case::HERE.covers(&a, &b) && Case::HERE.covers(&b, &a),
        _ => Case::HERE.covers(a, b) && Case::HERE.covers(b, a),
    }
}

/// `file` is `root` or below it, by where each really is when both exist and as written otherwise.
pub fn is_under(file: &Path, root: &Path) -> bool {
    match (file.canonicalize(), root.canonicalize()) {
        (Ok(file), Ok(root)) => Case::HERE.covers(&root, &file),
        _ => Case::HERE.covers(root, file),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_path_is_under_another_by_whole_folders_and_by_the_case_rule() {
        let root = Path::new("C:/mods/Foo");
        let inside = Path::new("C:/mods/Foo/common/a.txt");
        let shouted = Path::new("C:/MODS/foo/common/a.txt");
        let sibling = Path::new("C:/mods/Foo2/a.txt");

        for case in [Case::Blind, Case::Sensitive] {
            assert!(case.covers(root, inside));
            assert!(case.covers(root, root));
            assert!(!case.covers(inside, root));
            assert!(!case.covers(root, sibling));
        }
        assert!(Case::Blind.covers(root, shouted));
        assert!(!Case::Sensitive.covers(root, shouted));
    }

    #[test]
    fn a_file_is_known_by_where_it_is_and_a_missing_one_by_its_path() {
        let dir = tempfile::tempdir().expect("tempdir");
        let file = dir.path().join("a.txt");
        std::fs::write(&file, b"").expect("a file");

        assert!(same_file(&file, &dir.path().join(".").join("a.txt")));
        assert!(!same_file(&file, &dir.path().join("b.txt")));
        assert!(is_under(&file, dir.path()));
        assert!(!is_under(dir.path(), &file));
        assert!(is_under(&dir.path().join("gone.txt"), dir.path()));
    }
}
