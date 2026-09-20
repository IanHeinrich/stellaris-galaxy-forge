//! Top-level `key = { … }` definitions of one `common/` directory across
//! every layer, last key wins.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use sgf_core::cst::{self, Node, Value};

use crate::Diagnostic;
use crate::install::layers::Layout;

/// One definition block with the file bytes its spans point into.
#[derive(Debug, Clone)]
pub struct Def {
    pub node: Node,
    pub src: Arc<[u8]>,
    pub file: PathBuf,
    /// The defining file's top-level `@name = value` scalars, `@` stripped.
    pub vars: Arc<BTreeMap<String, String>>,
}

impl Def {
    /// The unquoted scalar value of the first direct child named `key`.
    pub fn scalar(&self, key: &str) -> Option<&str> {
        self.node.find(key, &self.src)?.scalar_str(&self.src)
    }

    pub fn flag(&self, key: &str) -> bool {
        self.scalar(key) == Some("yes")
    }
}

/// Parse every winning file of `rel_dir` in filename order and collect the
/// top-level keyed blocks. `@variables` are skipped; a file that fails to
/// parse contributes nothing and is reported. A repeated top-level key keeps
/// only its last block; files that repeat keys need `parse_file` + `find_deep`.
pub fn parse_dir(
    layout: &Layout,
    rel_dir: &str,
    diagnostics: &mut Vec<Diagnostic>,
) -> BTreeMap<String, Def> {
    let mut defs = BTreeMap::new();
    for file in layout.files_in(rel_dir) {
        let Some((root, src)) = parse_file(&file, diagnostics) else {
            continue;
        };
        let Value::Block { children, .. } = root.value else {
            continue;
        };
        let vars = Arc::new(file_vars(&children, &src));
        for node in children {
            let Some(key) = node.key_str(&src) else {
                continue;
            };
            if key.starts_with('@') || node.scalar_span().is_some() {
                continue;
            }
            let def = Def {
                node,
                src: Arc::clone(&src),
                file: file.clone(),
                vars: Arc::clone(&vars),
            };
            // A key repeated within one file is the game's own idiom (`random_list` in
            // planet_classes), not a mod overriding anything; the later block wins in silence.
            if let Some(previous) = defs.insert(key.to_owned(), def)
                && previous.file != file
            {
                diagnostics.push(Diagnostic::Override {
                    key: key.to_owned(),
                    from: previous.file,
                    to: file.clone(),
                });
            }
        }
    }
    defs
}

fn file_vars(children: &[Node], src: &[u8]) -> BTreeMap<String, String> {
    children
        .iter()
        .filter_map(|node| {
            let name = node.key_str(src)?.strip_prefix('@')?;
            Some((name.to_owned(), node.scalar_str(src)?.to_owned()))
        })
        .collect()
}

/// Parse one script file directly, for a caller whose layering is not the
/// "last file of this name wins" rule [`parse_dir`] applies (a single
/// well-known file, or a file whose top-level blocks repeat a key).
pub fn parse_file(file: &Path, diagnostics: &mut Vec<Diagnostic>) -> Option<(Node, Arc<[u8]>)> {
    let bytes: Arc<[u8]> = match fs::read(file) {
        Ok(bytes) => bytes.into(),
        Err(e) => {
            diagnostics.push(Diagnostic::Unreadable {
                file: file.to_path_buf(),
                reason: e.to_string(),
            });
            return None;
        }
    };
    match cst::parse_script(&bytes, 0) {
        Ok(root) => Some((root, bytes)),
        Err(e) => {
            diagnostics.push(Diagnostic::ParseError {
                file: file.to_path_buf(),
                offset: e.offset,
                reason: e.reason.to_owned(),
            });
            None
        }
    }
}

/// Every node named `key` at any depth below `node`, in file order.
pub fn find_deep<'n>(node: &'n Node, key: &str, src: &[u8], out: &mut Vec<&'n Node>) {
    for child in node.children() {
        if child.key_str(src) == Some(key) {
            out.push(child);
        }
        find_deep(child, key, src, out);
    }
}

/// The bare scalar items of a `key = { a b c }` list, over every such block.
pub fn list_items(node: &Node, key: &str, src: &[u8]) -> Vec<String> {
    node.find_all(key, src)
        .flat_map(|block| block.children())
        .filter(|item| item.key.is_none())
        .filter_map(|item| item.scalar_str(src))
        .map(str::to_owned)
        .collect()
}
