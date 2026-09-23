//! The reverse reference index: which script names which flag, event target
//! or initializer, which event each on_action fires, and every country a
//! `create_country` defines.

use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError};

use sgf_core::cst::{self, Node};
use sgf_core::projections::galaxy::FlagRef;

use crate::Diagnostic;
use crate::initializers::Initializers;
use crate::install::layers::{Layout, VANILLA};
use crate::install::script::{self, Def};
use crate::scripts::chain::{self, Chain};
use crate::scripts::claims::{self, Claims};
use crate::scripts::scan::{self, Dir};
use crate::scripts::scope::SAVES_TARGET;
use crate::scripts::view::ScriptRef;

/// Which kind of script a reference sits in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SiteKind {
    Initializer,
    ScriptedEffect,
    Event,
    OnAction,
}

/// One script naming a flag, an event target or an initializer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RefSite {
    /// The key the reference was written with, `has_star_flag`.
    pub verb: &'static str,
    /// The definition key, event id or on_action name that owns the line.
    pub owner: String,
    pub kind: SiteKind,
    pub location: ScriptRef,
}

/// A country a `create_country` block defines, and what it can be found by.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CreatedCountry {
    pub name_key: String,
    pub country_type: String,
    /// `flag.colors`, the `"null"` placeholders removed.
    pub colors: Vec<String>,
    pub icon: Option<FlagRef>,
    pub background: Option<FlagRef>,
    pub country_flags: Vec<String>,
    pub saves_targets: Vec<String>,
    pub location: ScriptRef,
}

/// A `prescripted_countries` entry, keyed by the initializer it starts in.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Prescripted {
    pub name_key: String,
    pub colors: Vec<String>,
    pub icon: Option<FlagRef>,
    pub background: Option<FlagRef>,
    pub location: ScriptRef,
}

/// Where a depth-0 `event = { … }` block is written.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EventLoc {
    pub file: PathBuf,
    /// Byte offset of the block's `{`, the statement [`ParsedScript::at`] finds.
    pub offset: usize,
    pub line: u32,
}

/// One script file's bytes and CST, parsed once and shared by everyone who
/// reaches the file.
#[derive(Debug)]
pub struct ParsedScript {
    pub src: Vec<u8>,
    pub root: Node,
}

impl ParsedScript {
    /// The depth-0 statement covering `offset`.
    pub fn at(&self, offset: usize) -> Option<&Node> {
        self.root
            .children()
            .iter()
            .find(|n| n.span().range().contains(&offset))
    }
}

#[derive(Debug, Default)]
pub struct ScriptIndex {
    refs: HashMap<String, Vec<RefSite>>,
    global_writes: HashMap<String, Vec<RefSite>>,
    /// Every event a mod layer defines, the base game's own left out.
    mod_events: HashMap<String, Vec<ScriptRef>>,
    fired_by: HashMap<String, Vec<String>>,
    effects: BTreeMap<String, Def>,
    by_country_flag: HashMap<String, CreatedCountry>,
    by_saved_target: HashMap<String, CreatedCountry>,
    prescripted: HashMap<String, Prescripted>,
    events: HashMap<String, EventLoc>,
    claims: Claims,
    /// Files parsed on demand, a failed parse remembered as `None`.
    parsed: Mutex<HashMap<PathBuf, Option<Arc<ParsedScript>>>>,
    /// Initializer chains walked on demand, one per initializer key.
    chains: Mutex<HashMap<String, Arc<Chain>>>,
    layers: Vec<(PathBuf, String)>,
}

/// The directories read for their own sake, and whether a CST failure in one
/// is news: nobody else parses `events` or `common/on_actions`.
const DIRS: [(&str, Dir, SiteKind, bool); 3] = [
    (
        "common/scripted_effects",
        Dir::Effects,
        SiteKind::ScriptedEffect,
        false,
    ),
    ("events", Dir::Events, SiteKind::Event, true),
    (
        "common/on_actions",
        Dir::OnActions,
        SiteKind::OnAction,
        true,
    ),
];

const PRESCRIPTED_DIR: &str = "prescripted_countries";

impl ScriptIndex {
    pub(crate) fn load(
        layout: &Layout,
        initializers: &Initializers,
        diagnostics: &mut Vec<Diagnostic>,
    ) -> Self {
        let mut index = Self {
            layers: layout
                .layers
                .iter()
                .map(|l| (l.root.clone(), l.name.clone()))
                .collect(),
            ..Self::default()
        };
        // A mod overriding a vanilla effect is the point of a mod, not a
        // diagnostic; anything else this parse finds still is.
        let mut parsing = Vec::new();
        index.effects = script::parse_dir(layout, "common/scripted_effects", &mut parsing);
        diagnostics.extend(
            parsing
                .into_iter()
                .filter(|d| !matches!(d, Diagnostic::Override { .. })),
        );
        index.scan_initializers(initializers);
        for (rel, dir, kind, report) in DIRS {
            index.ingest(layout, rel, dir, kind, report, diagnostics);
        }
        index.read_prescripted(layout, diagnostics);
        let claims = claims::build(&index, layout);
        index.claims = claims;
        index
    }

    /// The initializer directory is scanned from the bytes [`Initializers`]
    /// already read and parsed, so its files are opened exactly once.
    fn scan_initializers(&mut self, initializers: &Initializers) {
        for (file, bytes) in initializers.sources() {
            self.record(&file, &bytes, Dir::Initializers, SiteKind::Initializer);
            if contains(&bytes, b"create_country") {
                self.read_countries(&file, &bytes, &mut Vec::new());
            }
        }
    }

    /// Every script in loaded game data that names `token`.
    pub fn references(&self, token: &str) -> &[RefSite] {
        self.refs.get(token).map_or(&[][..], Vec::as_slice)
    }

    /// Every script in loaded game data that sets or removes the global flag `flag`.
    pub fn global_flag_writes(&self, flag: &str) -> &[RefSite] {
        self.global_writes.get(flag).map_or(&[][..], Vec::as_slice)
    }

    /// Where the loaded mods define the event with this id, in the order the game reads the files.
    pub fn mod_event_definitions(&self, id: &str) -> &[ScriptRef] {
        self.mod_events.get(id).map_or(&[][..], Vec::as_slice)
    }

    /// Where the event with this id is written; when two files define it,
    /// the one loaded last, as the game reads them.
    pub fn event(&self, id: &str) -> Option<&EventLoc> {
        self.events.get(id)
    }

    /// `file` read and parsed, at most once per index: a claim walk reaches
    /// the same event file from many systems and shares these bytes.
    pub fn parsed(&self, file: &Path) -> Option<Arc<ParsedScript>> {
        let mut cache = self.parsed.lock().unwrap_or_else(PoisonError::into_inner);
        cache
            .entry(file.to_path_buf())
            .or_insert_with(|| {
                let src = fs::read(file).ok()?;
                let root = cst::parse_script(&src, 0).ok()?;
                Some(Arc::new(ParsedScript { src, root }))
            })
            .clone()
    }

    /// `initializer`'s chain, kept per index: the walk is a pure function of
    /// the key, so two callers racing on one key simply walk it twice, and the
    /// inspector asks for it on every system it opens.
    pub fn chain(&self, initializers: &Initializers, initializer: &str) -> Arc<Chain> {
        if let Some(done) = self
            .chains
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(initializer)
        {
            return done.clone();
        }
        let walked = Arc::new(chain::walk(self, initializers, initializer));
        self.chains
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .entry(initializer.to_owned())
            .or_insert(walked)
            .clone()
    }

    /// The systems the game-start events claim before the player's first frame.
    pub fn claims(&self) -> &Claims {
        &self.claims
    }

    /// The on_actions and events that fire `event`, in the order found.
    pub fn callers_of(&self, event: &str) -> &[String] {
        self.fired_by.get(event).map_or(&[][..], Vec::as_slice)
    }

    pub fn effect(&self, key: &str) -> Option<&Def> {
        self.effects.get(key)
    }

    pub fn country_of_flag(&self, flag: &str) -> Option<&CreatedCountry> {
        self.by_country_flag.get(flag)
    }

    pub fn country_of_target(&self, token: &str) -> Option<&CreatedCountry> {
        self.by_saved_target.get(token)
    }

    pub fn prescripted(&self, initializer: &str) -> Option<&Prescripted> {
        self.prescripted.get(initializer)
    }

    pub fn is_empty(&self) -> bool {
        self.refs.is_empty() && self.effects.is_empty()
    }

    /// A reference to `line` of `file`, named by the layer the file came from.
    pub fn script_ref(&self, file: &Path, line: u32) -> ScriptRef {
        script_ref(&self.layers, file, line)
    }

    /// The reference to a node's first byte, in the file its `Def` came from.
    pub(crate) fn node_ref(&self, def_file: &Path, src: &[u8], node: &Node) -> ScriptRef {
        self.script_ref(def_file, line_of(src, node.span().start))
    }

    fn ingest(
        &mut self,
        layout: &Layout,
        rel: &str,
        dir: Dir,
        kind: SiteKind,
        report: bool,
        diagnostics: &mut Vec<Diagnostic>,
    ) {
        for file in layout.files_in(rel) {
            let bytes = match fs::read(&file) {
                Ok(bytes) => bytes,
                Err(e) => {
                    diagnostics.push(Diagnostic::Unreadable {
                        file,
                        reason: e.to_string(),
                    });
                    continue;
                }
            };
            self.record(&file, &bytes, dir, kind);
            if contains(&bytes, b"create_country") {
                let mut sink = Vec::new();
                self.read_countries(&file, &bytes, &mut sink);
                if report {
                    diagnostics.append(&mut sink);
                }
            }
        }
    }

    /// One file's references and event calls.
    fn record(&mut self, file: &Path, bytes: &[u8], dir: Dir, kind: SiteKind) {
        let scanned = scan::scan(bytes, dir);
        for hit in scanned.hits {
            let location = script_ref(&self.layers, file, hit.line);
            self.refs.entry(hit.token).or_default().push(RefSite {
                verb: hit.verb,
                owner: hit.owner,
                kind,
                location,
            });
        }
        for write in scanned.global_writes {
            let location = script_ref(&self.layers, file, write.line);
            self.global_writes
                .entry(write.token)
                .or_default()
                .push(RefSite {
                    verb: write.verb,
                    owner: write.owner,
                    kind,
                    location,
                });
        }
        for fired in scanned.fired {
            self.fired_by.entry(fired.event).or_default().push(fired.by);
        }
        for event in scanned.events {
            let location = script_ref(&self.layers, file, event.line);
            if location.layer != VANILLA {
                self.mod_events
                    .entry(event.id.clone())
                    .or_default()
                    .push(location);
            }
            self.events.insert(
                event.id,
                EventLoc {
                    file: file.to_path_buf(),
                    offset: event.offset,
                    line: event.line,
                },
            );
        }
    }

    /// The `create_country` blocks of one file. A CST failure is only news
    /// where nothing else parses the directory; elsewhere the loader that
    /// does has already reported it, and all that is lost here is a
    /// territory's name and colours.
    fn read_countries(&mut self, file: &Path, bytes: &[u8], diagnostics: &mut Vec<Diagnostic>) {
        let root = match cst::parse_script(bytes, 0) {
            Ok(root) => root,
            Err(e) => {
                diagnostics.push(Diagnostic::ParseError {
                    file: file.to_path_buf(),
                    offset: e.offset,
                    reason: e.reason.to_owned(),
                });
                return;
            }
        };
        let mut blocks = Vec::new();
        created_countries(&root, bytes, &mut blocks);
        for (block, next) in blocks {
            let location = script_ref(&self.layers, file, line_of(bytes, block.span().start));
            let Some(mut country) = read_country(block, bytes, location) else {
                continue;
            };
            if let Some(scope) = next.filter(|n| n.key_str(bytes) == Some("last_created_country")) {
                country
                    .country_flags
                    .extend(values_of(scope, "set_country_flag", bytes));
                country.saves_targets.extend(saved_targets(scope, bytes));
            }
            for flag in &country.country_flags {
                self.by_country_flag.insert(flag.clone(), country.clone());
            }
            for target in &country.saves_targets {
                self.by_saved_target.insert(target.clone(), country.clone());
            }
        }
    }

    fn read_prescripted(&mut self, layout: &Layout, diagnostics: &mut Vec<Diagnostic>) {
        let defs = script::parse_dir(layout, PRESCRIPTED_DIR, diagnostics);
        for def in in_file_order(&layout.files_in(PRESCRIPTED_DIR), &defs) {
            let src = &def.src;
            let Some(initializer) = def.scalar("initializer") else {
                continue;
            };
            let Some(name_key) = def.scalar("name") else {
                continue;
            };
            let flag = def.node.find("empire_flag", src);
            let location = script_ref(&self.layers, &def.file, line_of(src, def.node.span().start));
            self.prescripted.insert(
                initializer.to_owned(),
                Prescripted {
                    name_key: name_key.to_owned(),
                    colors: flag.map(|f| colors(f, src)).unwrap_or_default(),
                    icon: flag.and_then(|f| flag_ref(f, "icon", src)),
                    background: flag.and_then(|f| flag_ref(f, "background", src)),
                    location,
                },
            );
        }
    }
}

/// `defs` in the order the game reads them: by file, then by where each
/// block sits in it, rather than by the key [`script::parse_dir`] maps them on.
fn in_file_order<'d>(files: &[PathBuf], defs: &'d BTreeMap<String, Def>) -> Vec<&'d Def> {
    let rank: HashMap<&Path, usize> = files
        .iter()
        .enumerate()
        .map(|(at, file)| (file.as_path(), at))
        .collect();
    let mut ordered: Vec<&Def> = defs.values().collect();
    ordered.sort_by_key(|def| {
        (
            rank.get(def.file.as_path()).copied().unwrap_or(usize::MAX),
            def.node.span().start,
        )
    });
    ordered
}

/// Every `create_country` block, each with the statement that follows it.
/// A guardian names itself in a `last_created_country` sibling rather than
/// inside the block, so the block alone is not the whole country.
fn created_countries<'n>(node: &'n Node, src: &[u8], out: &mut Vec<(&'n Node, Option<&'n Node>)>) {
    let children = node.children();
    for (at, child) in children.iter().enumerate() {
        if child.key_str(src) == Some("create_country") {
            out.push((child, children.get(at + 1)));
        }
        created_countries(child, src, out);
    }
}

fn read_country(block: &Node, src: &[u8], location: ScriptRef) -> Option<CreatedCountry> {
    let name = block.find("name", src)?;
    let name_key = name
        .scalar_str(src)
        .or_else(|| name.find("key", src)?.scalar_str(src))?;
    let flag = block.find("flag", src);
    Some(CreatedCountry {
        name_key: name_key.to_owned(),
        country_type: block
            .find("type", src)
            .and_then(|t| t.scalar_str(src))
            .unwrap_or("default")
            .to_owned(),
        colors: flag.map(|f| colors(f, src)).unwrap_or_default(),
        icon: flag.and_then(|f| flag_ref(f, "icon", src)),
        background: flag.and_then(|f| flag_ref(f, "background", src)),
        country_flags: values_of(block, "set_country_flag", src),
        saves_targets: saved_targets(block, src),
        location,
    })
}

fn saved_targets(node: &Node, src: &[u8]) -> Vec<String> {
    SAVES_TARGET
        .iter()
        .flat_map(|key| values_of(node, key, src))
        .collect()
}

fn values_of(node: &Node, key: &str, src: &[u8]) -> Vec<String> {
    let mut found = Vec::new();
    script::find_deep(node, key, src, &mut found);
    found
        .into_iter()
        .filter_map(|n| n.scalar_str(src))
        .map(str::to_owned)
        .collect()
}

fn colors(flag: &Node, src: &[u8]) -> Vec<String> {
    script::list_items(flag, "colors", src)
        .into_iter()
        .filter(|c| c != "null")
        .collect()
}

fn flag_ref(flag: &Node, key: &str, src: &[u8]) -> Option<FlagRef> {
    let layer = flag.find(key, src)?;
    Some(FlagRef {
        category: layer.find("category", src)?.scalar_str(src)?.to_owned(),
        file: layer.find("file", src)?.scalar_str(src)?.to_owned(),
    })
}

fn script_ref(layers: &[(PathBuf, String)], file: &Path, line: u32) -> ScriptRef {
    let (relative, layer) = layers
        .iter()
        .rev()
        .find_map(|(root, name)| Some((file.strip_prefix(root).ok()?, name.as_str())))
        .unwrap_or((file, "unknown"));
    let path = relative
        .components()
        .map(|c| c.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/");
    ScriptRef {
        file: Some(file.display().to_string()),
        display: format!("{path}:{line}"),
        line,
        layer: layer.to_owned(),
    }
}

fn line_of(src: &[u8], offset: usize) -> u32 {
    let upto = offset.min(src.len());
    let lines = src[..upto].iter().filter(|&&b| b == b'\n').count();
    u32::try_from(lines + 1).unwrap_or(u32::MAX)
}

fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    haystack.windows(needle.len()).any(|w| w == needle)
}
