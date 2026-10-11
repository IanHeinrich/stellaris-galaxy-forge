//! What the `.asset` and `.gfx` files of `gfx/models` say about models: each entity's mesh,
//! scale, locators, attachments, mesh settings and planet surface, each `pdxmesh`'s file, and
//! every texture by file name. An entity is resolved into the meshes it draws, each with the
//! chain of attachments that places it, without reading any `.mesh` file.

use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::{Path, PathBuf};

use sgf_core::cst::{self, Node};
use walkdir::WalkDir;

use super::mesh::MeshFile;
use super::space::Affine;
use crate::install::layers::Layout;
use crate::install::script::last_scalar;
use crate::textures::planet_disc::{self, EntitySurface};

/// The culture the game falls back to for a model with none of the culture asked for.
pub(super) const FALLBACK_CULTURE: &str = "mammalian_01";
/// The culture a model key names for what no empire owns: the game draws its bare entity.
pub(super) const NO_CULTURE: &str = "none";
/// How many `attach` and `clone` steps are followed from the entity asked for.
const DEPTH: usize = 6;
/// The locator every assembly attaches its parts at, the model's origin when no file
/// places it.
pub(super) const ROOT: &str = "root";
/// Where models, their definitions and their textures are.
const MODELS: &str = "gfx/models";

#[derive(Debug, Default)]
pub(crate) struct Assets {
    entities: HashMap<String, Entity>,
    meshes: HashMap<String, MeshDef>,
    /// Every `.dds` under `gfx/models` by its lowercased file name; a later layer's wins.
    textures: HashMap<String, PathBuf>,
}

#[derive(Debug, Default, Clone)]
pub(in crate::textures) struct Entity {
    /// The folder of its `.asset` file, relative to a layer root.
    dir: String,
    pdxmesh: Option<String>,
    pub(in crate::textures) clone: Option<String>,
    /// Its `scale` as written, a file variable replaced by its value.
    pub(in crate::textures) scale: Option<String>,
    locators: Vec<(String, Affine)>,
    /// Each `attach`: the locator and the entity attached there.
    attach: Vec<(String, String)>,
    settings: Vec<MeshSettings>,
    /// Whether it names a mesh, mesh settings, an attachment, a particle or a state of its own.
    pub(in crate::textures) draws: bool,
    /// What it has for a planet surface. One that draws only other things keeps the surface
    /// of the entity of its name it replaces.
    pub(in crate::textures) surface: Option<EntitySurface>,
}

#[derive(Debug, Clone)]
struct MeshDef {
    file: String,
    scale: f32,
    settings: Vec<MeshSettings>,
}

/// A `meshsettings` block: what the shape's mesh at `index` is drawn with, in place of what
/// its `.mesh` file stores.
#[derive(Debug, Clone, Default, Hash)]
pub(super) struct MeshSettings {
    pub(super) shape: String,
    pub(super) index: usize,
    pub(super) shader: Option<String>,
    pub(super) diffuse: Option<String>,
    pub(super) normal: Option<String>,
    pub(super) specular: Option<String>,
}

impl MeshSettings {
    /// Whether this block is for mesh `index` of `shape`. A Maya path (`group|shape`) matches
    /// its last part too.
    pub(super) fn matches(&self, shape: &str, index: usize) -> bool {
        let last = |s: &str| s.rsplit('|').next().unwrap_or(s).to_owned();
        self.index == index && (self.shape == shape || last(&self.shape) == last(shape))
    }
}

/// One step of the chain from a model's origin to one of its parts.
#[derive(Debug, Clone, Hash)]
pub(super) enum Step {
    Fixed(Affine),
    /// A locator or joint of the `.mesh` file `file`, read when the model is drawn. A part
    /// placed at a locator the file lacks is not drawn, unless the locator is [`ROOT`].
    Locator {
        file: String,
        name: String,
    },
}

/// One mesh file an entity draws, and the steps that place it.
#[derive(Debug, Hash)]
pub(super) struct Placed {
    /// The `.mesh` file, relative to a layer root.
    pub(super) file: String,
    /// The folder of the `.asset` file that named it.
    pub(super) asset_dir: String,
    pub(super) steps: Vec<Step>,
    /// The entity's own settings, then its `pdxmesh`'s.
    pub(super) settings: Vec<MeshSettings>,
}

impl Assets {
    pub(crate) fn read(layout: &Layout) -> Self {
        let mut assets = Self::default();
        for (dir, path) in model_files(layout) {
            let ext = path
                .extension()
                .map(|e| e.to_string_lossy().to_ascii_lowercase());
            match ext.as_deref() {
                Some("asset") => {
                    if let Some((root, src)) = parse(&path) {
                        assets.read_asset(&dir, &root, &src);
                    }
                }
                Some("gfx") => {
                    if let Some((root, src)) = parse(&path) {
                        assets.read_gfx(&root, &src);
                    }
                }
                Some("dds") => {
                    if let Some(name) = path.file_name() {
                        let name = name.to_string_lossy().to_ascii_lowercase();
                        assets.textures.insert(name, path);
                    }
                }
                _ => {}
            }
        }
        assets
    }

    fn read_asset(&mut self, dir: &str, root: &Node, src: &[u8]) {
        let vars = Vars::of(root, src);
        for node in root
            .children()
            .iter()
            .filter(|n| n.key_str(src) == Some("entity"))
        {
            let Some(name) = last_scalar(node, "name", src) else {
                continue;
            };
            let locators = node
                .find_all("locator", src)
                .filter_map(|l| {
                    let name = last_scalar(l, "name", src)?;
                    let position = vars.triple(l, "position", src).unwrap_or([0.0; 3]);
                    let rotation = vars.triple(l, "rotation", src).unwrap_or([0.0; 3]);
                    let scale = vars.number(l, "scale", src).unwrap_or(1.0);
                    Some((
                        name.to_owned(),
                        Affine::from_euler(rotation, scale, position),
                    ))
                })
                .collect();
            let attach = node
                .find_all("attach", src)
                .flat_map(Node::children)
                .filter_map(|a| {
                    let locator = a.key_str(src)?;
                    let entity = a.scalar_str(src).filter(|e| !e.is_empty())?;
                    Some((locator.to_owned(), entity.to_owned()))
                })
                .collect();
            let (draws, surface) = planet_disc::entity_surface(node, dir, src);
            let surface =
                surface.or_else(|| self.entities.get(name).filter(|_| draws)?.surface.clone());
            let entity = Entity {
                dir: dir.to_owned(),
                pdxmesh: last_scalar(node, "pdxmesh", src).map(str::to_owned),
                clone: last_scalar(node, "clone", src).map(str::to_owned),
                scale: last_scalar(node, "scale", src)
                    .and_then(|s| vars.resolve(s))
                    .map(str::to_owned),
                locators,
                attach,
                settings: settings(node, &vars, src),
                draws,
                surface,
            };
            self.entities.insert(name.to_owned(), entity);
        }
    }

    fn read_gfx(&mut self, root: &Node, src: &[u8]) {
        let vars = Vars::of(root, src);
        for types in root
            .children()
            .iter()
            .filter(|n| n.key_str(src) == Some("objectTypes"))
        {
            for mesh in types.find_all("pdxmesh", src) {
                let name = last_scalar(mesh, "name", src);
                let file = last_scalar(mesh, "file", src);
                if let (Some(name), Some(file)) = (name, file) {
                    let def = MeshDef {
                        file: file.replace('\\', "/"),
                        scale: vars.number(mesh, "scale", src).unwrap_or(1.0),
                        settings: settings(mesh, &vars, src),
                    };
                    self.meshes.insert(name.to_owned(), def);
                }
            }
        }
    }

    /// The first of `<culture>_<entity>` for each of `cultures` in turn, then
    /// `mammalian_01_<entity>` and `<entity>`, that an `.asset` file defines. For
    /// [`NO_CULTURE`], `<entity>` comes first.
    pub(super) fn entity_name(&self, cultures: &[String], entity: &str) -> Option<String> {
        if cultures.iter().any(|c| c == NO_CULTURE) && self.entities.contains_key(entity) {
            return Some(entity.to_owned());
        }
        let fallback =
            (!cultures.iter().any(|c| c == FALLBACK_CULTURE)).then_some(FALLBACK_CULTURE);
        cultures
            .iter()
            .map(String::as_str)
            .chain(fallback)
            .map(|culture| format!("{culture}_{entity}"))
            .chain([entity.to_owned()])
            .find(|name| self.entities.contains_key(name))
    }

    /// `name` as the last `.asset` file to define it writes it.
    pub(in crate::textures) fn defined(&self, name: &str) -> Option<&Entity> {
        self.entities.get(name)
    }

    /// The `.mesh` file of model `mesh`, relative to a layer root.
    pub(in crate::textures) fn mesh_file(&self, mesh: &str) -> Option<&str> {
        self.meshes.get(mesh).map(|def| def.file.as_str())
    }

    /// Every mesh file `name` draws, itself and through what it attaches, with the steps that
    /// place it; `None` when no `.asset` file defines `name`.
    pub(super) fn resolve(&self, name: &str) -> Option<Vec<Placed>> {
        self.entities.get(name)?;
        let mut placed = Vec::new();
        self.place(name, &[], &mut Vec::new(), &mut placed);
        Some(placed)
    }

    /// An attached entity no `.asset` file defines draws nothing.
    fn place(&self, name: &str, steps: &[Step], path: &mut Vec<String>, placed: &mut Vec<Placed>) {
        if path.len() > DEPTH || path.iter().any(|p| p == name) {
            return;
        }
        let Some(entity) = self.entity(name, DEPTH) else {
            return;
        };
        let mut own = steps.to_vec();
        let scale = entity.scale.as_deref().and_then(number).unwrap_or(1.0);
        own.push(Step::Fixed(Affine::scale(scale)));
        let drawn = entity.pdxmesh.as_ref().and_then(|m| self.meshes.get(m));
        let in_mesh = |def: &MeshDef| Step::Fixed(Affine::scale(def.scale));
        path.push(name.to_owned());
        for (locator, child) in &entity.attach {
            let at = match entity.locators.iter().find(|(n, _)| n == locator) {
                Some((_, t)) => vec![Step::Fixed(*t)],
                None => match drawn {
                    Some(def) => vec![
                        in_mesh(def),
                        Step::Locator {
                            file: def.file.clone(),
                            name: locator.clone(),
                        },
                    ],
                    None if locator == ROOT => Vec::new(),
                    None => continue,
                },
            };
            let mut chain = own.clone();
            chain.extend(at);
            self.place(child, &chain, path, placed);
        }
        path.pop();
        if let Some(def) = drawn {
            let mut settings = entity.settings.clone();
            settings.extend(def.settings.iter().cloned());
            own.push(in_mesh(def));
            placed.push(Placed {
                file: def.file.clone(),
                asset_dir: entity.dir.clone(),
                steps: own,
                settings,
            });
        }
    }

    /// `name`'s definition, with what it leaves out taken from the entity it `clone`s.
    fn entity(&self, name: &str, depth: usize) -> Option<Entity> {
        let own = self.entities.get(name)?;
        let Some(source) = own
            .clone
            .as_deref()
            .filter(|_| depth > 0)
            .and_then(|c| self.entity(c, depth - 1))
        else {
            return Some(own.clone());
        };
        Some(Entity {
            pdxmesh: own.pdxmesh.clone().or(source.pdxmesh),
            clone: None,
            scale: own.scale.clone().or(source.scale),
            locators: or_inherited(&own.locators, &source.locators),
            attach: or_inherited(&own.attach, &source.attach),
            settings: or_inherited(&own.settings, &source.settings),
            ..own.clone()
        })
    }

    /// The texture file `name` names for a mesh in `mesh_dir` of an entity in `asset_dir`:
    /// the path as written, beside the mesh, beside the `.asset`, then any file of that name
    /// under `gfx/models`.
    pub(super) fn texture(
        &self,
        layout: &Layout,
        name: &str,
        mesh_dir: &str,
        asset_dir: &str,
    ) -> Option<PathBuf> {
        let name = name.replace('\\', "/");
        if name.is_empty() {
            return None;
        }
        let file = name.rsplit('/').next().unwrap_or(&name);
        [
            name.clone(),
            format!("{mesh_dir}/{file}"),
            format!("{asset_dir}/{file}"),
        ]
        .iter()
        .find_map(|rel| layout.resolve_file(rel))
        .or_else(|| self.textures.get(&file.to_ascii_lowercase()).cloned())
    }
}

/// `own`, or what the cloned entity has when `own` is empty.
fn or_inherited<T: Clone>(own: &[T], source: &[T]) -> Vec<T> {
    if own.is_empty() { source } else { own }.to_vec()
}

/// The `.asset`, `.gfx` and `.dds` files under `gfx/models` in the layers of `layout`, one
/// walk per layer, each with its folder relative to its layer root, in layer order then path
/// order. A later layer's file of the same path replaces the earlier one.
fn model_files(layout: &Layout) -> Vec<(String, PathBuf)> {
    const KINDS: [&str; 3] = ["asset", "gfx", "dds"];
    let mut files: BTreeMap<String, (usize, String, PathBuf)> = BTreeMap::new();
    for (index, layer) in layout.layers.iter().enumerate() {
        let root = MODELS.split('/').fold(layer.root.clone(), |p, s| p.join(s));
        for entry in WalkDir::new(&root)
            .sort_by_file_name()
            .into_iter()
            .flatten()
        {
            let wanted = entry
                .path()
                .extension()
                .is_some_and(|e| KINDS.iter().any(|k| e.eq_ignore_ascii_case(k)))
                && (entry.file_type().is_file() || entry.path().is_file());
            if !wanted {
                continue;
            }
            let path = entry.into_path();
            let Ok(rel) = path.strip_prefix(&layer.root) else {
                continue;
            };
            let rel = rel.to_string_lossy().replace('\\', "/");
            let dir = rel.rsplit_once('/').map_or("", |(dir, _)| dir).to_owned();
            files.insert(rel.to_ascii_lowercase(), (index, dir, path));
        }
    }
    let mut ordered: Vec<(usize, String, PathBuf)> = files.into_values().collect();
    ordered.sort();
    ordered
        .into_iter()
        .map(|(_, dir, path)| (dir, path))
        .collect()
}

fn parse(path: &Path) -> Option<(Node, Vec<u8>)> {
    let src = fs::read(path).ok()?;
    let root = cst::parse_script(&src, 0).ok()?;
    Some((root, src))
}

/// Where `locator` sits in `mesh`'s bind pose: one of its locators, moved with its joint when
/// it has one, or a joint of that name.
pub(super) fn locate(mesh: &MeshFile, locator: &str) -> Option<Affine> {
    let joint = |name: &str| {
        mesh.shapes
            .iter()
            .flat_map(|s| &s.joints)
            .find(|j| j.name == name)
            .map(|j| Affine::from_columns(&j.inverse_bind).inverse())
    };
    if let Some(l) = mesh.locators.iter().find(|l| l.name == locator) {
        let own = Affine::from_quaternion(l.rotation, l.position);
        let parent = l.parent.as_deref().and_then(joint);
        return Some(parent.map_or(own, |p| p.then_before(own)));
    }
    joint(locator)
}

fn settings(node: &Node, vars: &Vars<'_>, src: &[u8]) -> Vec<MeshSettings> {
    node.find_all("meshsettings", src)
        .filter_map(|m| {
            let text = |key: &str| last_scalar(m, key, src).map(str::to_owned);
            Some(MeshSettings {
                shape: text("name")?,
                index: vars
                    .number(m, "index", src)
                    .map_or(0, |i| i.max(0.0) as usize),
                shader: text("shader"),
                diffuse: text("texture_diffuse"),
                normal: text("texture_normal"),
                specular: text("texture_specular"),
            })
        })
        .collect()
}

/// A file's own `@name = value` variables.
struct Vars<'a>(BTreeMap<&'a str, &'a str>);

impl<'a> Vars<'a> {
    fn of(root: &Node, src: &'a [u8]) -> Self {
        Self(
            root.children()
                .iter()
                .filter_map(|n| Some((n.key_str(src)?.strip_prefix('@')?, n.scalar_str(src)?)))
                .collect(),
        )
    }

    /// `text`, or the value of the variable `@<name>` it names.
    fn resolve<'t>(&'t self, text: &'t str) -> Option<&'t str> {
        match text.strip_prefix('@') {
            Some(name) => self.0.get(name).copied(),
            None => Some(text),
        }
    }

    fn value(&self, text: &str) -> Option<f32> {
        number(self.resolve(text)?)
    }

    fn number(&self, node: &Node, key: &str, src: &[u8]) -> Option<f32> {
        self.value(last_scalar(node, key, src)?)
    }

    /// The three numbers of `key = { x y z }`.
    fn triple(&self, node: &Node, key: &str, src: &[u8]) -> Option<[f32; 3]> {
        let block = node.find_all(key, src).last()?;
        let numbers: Vec<f32> = block
            .children()
            .iter()
            .filter_map(|c| self.value(c.scalar_str(src)?))
            .collect();
        match numbers[..] {
            [x, y, z, ..] => Some([x, y, z]),
            _ => None,
        }
    }
}

fn number(text: &str) -> Option<f32> {
    text.trim_end_matches('f').parse().ok()
}
