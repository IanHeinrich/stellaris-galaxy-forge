//! `interface/*.gfx`: sprite definitions the map draws (planet, resource
//! and starbase icons). Each file is one or more `spriteTypes = { … }`
//! blocks with repeated `spriteType`-family children, so [`crate::install::script`]'s
//! "last key wins" directory parse does not apply; every file is parsed on
//! its own and sprites are merged into the registry by name, vanilla first
//! then each mod in load order, so a mod replaces a vanilla sprite by name.

use std::path::{Path, PathBuf};

use sgf_core::cst::Node;
use walkdir::WalkDir;

use crate::Diagnostic;
use crate::install::layers::Layout;
use crate::install::script;
use crate::registries::registry::Registry;

pub type Sprites = Registry<SpriteDef>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SpriteDef {
    pub name: String,
    /// As written in the definition: forward slashes, relative to a layer root.
    pub file: String,
    pub frames: u32,
    /// `(sheet sprite name, default frame)` when this sprite is one frame of
    /// another sprite's sheet.
    pub sheet: Option<(String, u32)>,
}

impl Sprites {
    /// The texture file and, for a sheet-frame sprite, the 1-based frame to
    /// crop. `None` when `name` or (for a sheet-frame sprite) its sheet is
    /// unknown.
    pub fn resolve(&self, name: &str, frame: Option<u32>) -> Option<(String, Option<u32>)> {
        let def = self.get(name)?;
        match &def.sheet {
            Some((sheet_name, default_frame)) => {
                let sheet = self.get(sheet_name)?;
                Some((sheet.file.clone(), Some(frame.unwrap_or(*default_frame))))
            }
            None => Some((def.file.clone(), frame.filter(|_| def.frames > 1))),
        }
    }

    /// Frame count of the texture [`Self::resolve`] returns.
    pub fn frame_count(&self, name: &str) -> Option<u32> {
        let def = self.get(name)?;
        match &def.sheet {
            Some((sheet_name, _)) => self.get(sheet_name).map(|s| s.frames),
            None => Some(def.frames),
        }
    }
}

pub(crate) fn load(layout: &Layout, diagnostics: &mut Vec<Diagnostic>) -> Sprites {
    let mut sprites = Sprites::default();
    for layer in &layout.layers {
        for file in gfx_files(&layer.root.join("interface")) {
            let Some((root, src)) = script::parse_file(&file, diagnostics) else {
                continue;
            };
            read_sprite_types(&root, &src, &mut sprites);
        }
    }
    sprites
}

fn gfx_files(interface_dir: &Path) -> Vec<PathBuf> {
    WalkDir::new(interface_dir)
        .sort_by_file_name()
        .into_iter()
        .flatten()
        .filter(|e| e.file_type().is_file())
        .map(|e| e.into_path())
        .filter(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case("gfx")))
        .collect()
}

fn read_sprite_types(root: &Node, src: &[u8], sprites: &mut Sprites) {
    for group in root
        .children()
        .iter()
        .filter(|c| c.key_str(src) == Some("spriteTypes"))
    {
        for child in group.children() {
            if !child.key_str(src).is_some_and(is_sprite_type_key) {
                continue;
            }
            if let Some(def) = read_sprite(child, src) {
                sprites.insert(def.name.clone(), def);
            }
        }
    }
}

/// `spriteType`, `frameAnimatedSpriteType`, `corneredTileSpriteType`,
/// `textSpriteType`, …: every key ending in `SpriteType`, case-insensitive
/// so the plain `spriteType` itself counts.
fn is_sprite_type_key(key: &str) -> bool {
    const SUFFIX: &str = "spritetype";
    key.len() >= SUFFIX.len() && key[key.len() - SUFFIX.len()..].eq_ignore_ascii_case(SUFFIX)
}

fn read_sprite(node: &Node, src: &[u8]) -> Option<SpriteDef> {
    let name = field(node, "name", src)?.to_owned();
    let file = field(node, "texturefile", src)
        .or_else(|| field(node, "textureFile", src))
        .unwrap_or_default()
        .to_owned();
    let frames = field(node, "noOfFrames", src)
        .and_then(|s| s.parse().ok())
        .unwrap_or(1);
    let sheet = field(node, "sprite_sheet_sprite_type", src).map(|sheet_name| {
        let default_frame = field(node, "default_frame", src)
            .and_then(|s| s.parse().ok())
            .unwrap_or(1);
        (sheet_name.to_owned(), default_frame)
    });
    Some(SpriteDef {
        name,
        file,
        frames,
        sheet,
    })
}

fn field<'a>(node: &Node, key: &str, src: &'a [u8]) -> Option<&'a str> {
    node.find(key, src)?.scalar_str(src)
}
