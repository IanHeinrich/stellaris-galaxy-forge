//! What the install and the enabled mods define that the editor cannot show properly, for
//! `sgf gamedata --report`: the classes it has no name, disc, size or star body for, the
//! megastructures it cannot draw, add or follow, and what the load ran into.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Write;
use std::num::NonZero;
use std::path::Path;

use crate::construction::ring_world::{RingStage, quadrants, ring_world};
use crate::install::layers::VANILLA;
use crate::registries::megastructure_offers::NOT_OFFERED_YET;
use crate::registries::megastructures::{MegastructureDef, Placement, Unsupported};
use crate::registries::planet_classes::PlanetClassDef;
use crate::textures::{TextureKey, Textures};
use crate::{Diagnostic, GameData};

/// The seed a shattered class is baked with where no planet gives one, as the app's class
/// picker bakes it.
const SHATTERED_SEED: u32 = 1;
/// The culture a model key names for a row no empire owns, as the app draws one.
const NO_CULTURE: &str = "none";

/// One thing the report lists.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Row {
    /// The class key, or the diagnostic's kind.
    pub key: String,
    /// The layer whose file defined it last: a mod's name, or `vanilla`.
    pub source: String,
    pub detail: Option<String>,
}

/// One titled list of the report.
#[derive(Debug, Clone, Copy)]
pub struct Section<'a> {
    pub title: &'static str,
    pub rows: &'a [Row],
}

#[derive(Debug, Clone, Default)]
pub struct PlaysetReport {
    /// How many diagnostics the load raised, by kind.
    pub diagnostics: BTreeMap<&'static str, usize>,
    /// Every diagnostic but an override, which is how a mod changes the game.
    pub load_problems: Vec<Row>,
    /// Planet classes only ever given to a planet as its look.
    pub look_only: Vec<Row>,
    /// Planet classes whose model draws nothing, with the model.
    pub hidden_model: Vec<Row>,
    /// Planet classes a random draw can roll (`spawn_odds` above 0) with no localised name.
    pub unnamed_rolled: Vec<Row>,
    /// The other planet classes with no localised name, neither look-only nor hidden-model.
    pub unnamed_unrolled: Vec<Row>,
    /// Planet classes the app draws as a baked disc whose disc does not bake, with the reason;
    /// no look-only class.
    pub discs_failing: Vec<Row>,
    pub no_planet_size: Vec<Row>,
    /// Star classes whose map icon does not load, with the reason.
    pub star_art_missing: Vec<Row>,
    /// Star classes defined only so their key is valid, left out of the star pickers.
    pub placeholder_stars: Vec<Row>,
    /// Star classes with no star body; no placeholder.
    pub stars_without_body: Vec<Row>,
    /// Star classes never rolled that list more stars than any class the base game rolls has,
    /// with their planet classes.
    pub star_choices: Vec<Row>,
    /// The other star classes with more than one star body, with their planet classes.
    pub stars_with_bodies: Vec<Row>,
    /// Megastructure types whose model does not load, with the reason.
    pub models_failing: Vec<Row>,
    /// The shaders megastructure models are drawn with that no table of the model baker names,
    /// so they are drawn opaque by default; each on the first type that uses it, a base game
    /// type where one does, whose mod the row names.
    pub untabled_shaders: Vec<Row>,
    /// Megastructure types the editor does not add, with why; no ring world, which has a list
    /// of its own.
    pub unsupported: Vec<Row>,
    /// The first stages of the families the add dialog holds back that the playset defines.
    pub held_back: Vec<Row>,
    /// Each effect a megastructure's construction keeps that the walk cannot place, on the
    /// first stage of its chain that meets it.
    pub unfollowed: Vec<Row>,
    /// Ring world sites whose chain lays out no ring the editor can add, with the reason.
    pub rings_failing: Vec<Row>,
}

impl PlaysetReport {
    /// The report on `gd`, baking each disc through `textures` and its cache.
    pub fn new(gd: &GameData, textures: &Textures) -> Self {
        let planet_row =
            |key: &str, detail: Option<String>| row(key, gd.planet_class_source(key), detail);
        let star_row =
            |key: &str, detail: Option<String>| row(key, gd.star_class_source(key), detail);

        let mut diagnostics = BTreeMap::new();
        for d in &gd.diagnostics {
            *diagnostics.entry(d.kind()).or_default() += 1;
        }
        let load_problems = gd
            .diagnostics
            .iter()
            .filter(|d| !matches!(d, Diagnostic::Override { .. }))
            .map(|d| Row {
                key: d.kind().to_owned(),
                source: diagnostic_source(gd, d),
                detail: Some(d.to_string()),
            })
            .collect();

        let (mut look_only, mut hidden_model) = (Vec::new(), Vec::new());
        let (mut unnamed_rolled, mut unnamed_unrolled) = (Vec::new(), Vec::new());
        let mut discs_failing = Vec::new();
        let mut no_planet_size = Vec::new();
        let classes: Vec<&PlanetClassDef> = gd.planet_classes.iter().collect();
        let rings = ring_bodies(gd);
        let disc_errors = on_every_core(&classes, |pc| {
            let key = disc_key(gd, pc, &rings)?;
            gd.texture_png(textures, &key).err().map(|e| e.to_string())
        });
        for (pc, disc_error) in classes.into_iter().zip(disc_errors) {
            if pc.look_only {
                look_only.push(planet_row(&pc.key, None));
            }
            if pc.hidden_model {
                hidden_model.push(planet_row(&pc.key, pc.entity.clone()));
            }
            let expected = pc.look_only || pc.hidden_model;
            if gd.loc.name(&pc.key).is_none() && !expected {
                let unnamed = if pc.spawn_odds > 0.0 {
                    &mut unnamed_rolled
                } else {
                    &mut unnamed_unrolled
                };
                unnamed.push(planet_row(&pc.key, None));
            }
            if disc_error.is_some() && !pc.look_only {
                discs_failing.push(planet_row(&pc.key, disc_error));
            }
            if pc.planet_size.is_none() {
                no_planet_size.push(planet_row(&pc.key, None));
            }
        }

        let (mut star_art_missing, mut placeholder_stars) = (Vec::new(), Vec::new());
        let (mut stars_without_body, mut star_choices, mut stars_with_bodies) =
            (Vec::new(), Vec::new(), Vec::new());
        for sc in gd.star_classes.iter() {
            let icon = TextureKey::StarClass {
                icon: sc.texture_icon().to_owned(),
            }
            .to_string();
            if let Err(e) = gd.texture_png(textures, &icon) {
                star_art_missing.push(star_row(&sc.key, Some(e.to_string())));
            }
            let bodies = || Some(sc.planet_keys().collect::<Vec<_>>().join(" "));
            if sc.placeholder {
                placeholder_stars.push(star_row(&sc.key, None));
            } else if sc.alternatives {
                star_choices.push(star_row(&sc.key, bodies()));
            } else {
                match sc.planets.len() {
                    0 => stars_without_body.push(star_row(&sc.key, None)),
                    1 => {}
                    _ => stars_with_bodies.push(star_row(&sc.key, bodies())),
                }
            }
        }

        let (models_failing, untabled_shaders) = models(gd);
        Self {
            diagnostics,
            load_problems,
            look_only,
            hidden_model,
            unnamed_rolled,
            unnamed_unrolled,
            discs_failing,
            no_planet_size,
            star_art_missing,
            placeholder_stars,
            stars_without_body,
            star_choices,
            stars_with_bodies,
            models_failing,
            untabled_shaders,
            unsupported: unsupported(gd),
            held_back: held_back(gd),
            unfollowed: unfollowed(gd),
            rings_failing: rings_failing(gd),
        }
    }

    /// Every list of the report, in the order it prints.
    pub fn sections(&self) -> [Section<'_>; 18] {
        [
            ("load problems", &self.load_problems),
            ("look-only planet classes", &self.look_only),
            (
                "planet classes whose model draws nothing",
                &self.hidden_model,
            ),
            (
                "planet classes a random draw rolls, with no name",
                &self.unnamed_rolled,
            ),
            ("other planet classes with no name", &self.unnamed_unrolled),
            (
                "planet classes whose disc does not bake",
                &self.discs_failing,
            ),
            ("planet classes with no planet_size", &self.no_planet_size),
            (
                "star classes whose map icon does not load",
                &self.star_art_missing,
            ),
            ("placeholder star classes", &self.placeholder_stars),
            ("star classes with no star body", &self.stars_without_body),
            (
                "star classes listing more stars than a rolled class has",
                &self.star_choices,
            ),
            (
                "star classes with more than one star body",
                &self.stars_with_bodies,
            ),
            (
                "megastructure types whose model does not load",
                &self.models_failing,
            ),
            (
                "shaders megastructure models use, drawn opaque by default as no table names them",
                &self.untabled_shaders,
            ),
            (
                "megastructure types Galaxy Forge does not add, ring worlds aside",
                &self.unsupported,
            ),
            ("megastructure families held back", &self.held_back),
            (
                "megastructure construction effects not followed",
                &self.unfollowed,
            ),
            (
                "ring world sites whose chain lays out no ring",
                &self.rings_failing,
            ),
        ]
        .map(|(title, rows)| Section { title, rows })
    }

    /// The report as text: the diagnostics by kind, then each section's count and its first
    /// `rows` rows, every row when `rows` is `None`.
    pub fn text(&self, rows: Option<usize>) -> String {
        let mut out = String::new();
        let total: usize = self.diagnostics.values().sum();
        let _ = writeln!(out, "diagnostics: {total}");
        for (kind, count) in &self.diagnostics {
            let _ = writeln!(out, "  {kind:<14} {count}");
        }
        for section in self.sections() {
            let _ = writeln!(out, "{}: {}", section.title, section.rows.len());
            let shown = rows.unwrap_or(usize::MAX);
            for row in section.rows.iter().take(shown) {
                let _ = write!(out, "  {}  [{}]", row.key, row.source);
                if let Some(detail) = &row.detail {
                    let _ = write!(out, "  {detail}");
                }
                out.push('\n');
            }
            if section.rows.len() > shown {
                let _ = writeln!(out, "  ... {} more", section.rows.len() - shown);
            }
        }
        out
    }
}

/// What reading each megastructure type's model bare, as the app draws a row no empire owns,
/// finds: each type whose model does not load, with the reason, and each shader its drawn
/// meshes use that no table names, on the first type that uses it, a base game type where one
/// does, with how many do. The
/// meshes are read, nothing is baked, and a model several types share is read once.
fn models(gd: &GameData) -> (Vec<Row>, Vec<Row>) {
    let entities: Vec<&str> = gd
        .megastructures
        .iter()
        .filter_map(|def| def.entity.as_deref())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    let read = on_every_core(&entities, |entity| {
        let key = TextureKey::Model {
            culture: NO_CULTURE.to_owned(),
            entity: (*entity).to_owned(),
            yaw: 0,
            tilt: None,
            px: None,
        };
        gd.untabled_shaders(&key.to_string())
            .map_err(|e| e.to_string())
    });
    let read: BTreeMap<&str, Result<BTreeSet<String>, String>> =
        entities.into_iter().zip(read).collect();
    let mut failing = Vec::new();
    let mut shaders: BTreeMap<&str, (&MegastructureDef, usize)> = BTreeMap::new();
    for def in gd.megastructures.iter() {
        let Some(found) = def.entity.as_deref().and_then(|entity| read.get(entity)) else {
            continue;
        };
        match found {
            Err(error) => failing.push(mega_row(def, Some(error.clone()))),
            Ok(untabled) => {
                for shader in untabled {
                    let (first, count) = shaders.entry(shader).or_insert((def, 0));
                    if first.source.is_some() && def.source.is_none() {
                        *first = def;
                    }
                    *count += 1;
                }
            }
        }
    }
    let untabled = shaders
        .into_iter()
        .map(|(shader, (first, count))| {
            let detail = format!(
                "drawn opaque by default; {}, the mod named is that of {}",
                plural(count),
                first.key
            );
            row(shader, first.source.clone(), Some(detail))
        })
        .collect();
    (failing, untabled)
}

/// `count` megastructure types, in words.
fn plural(count: usize) -> String {
    match count {
        1 => "1 type".to_owned(),
        _ => format!("{count} types"),
    }
}

/// Each megastructure type the editor does not add, with why, but for the stages of a ring
/// world, which the editor adds whole.
fn unsupported(gd: &GameData) -> Vec<Row> {
    gd.megastructures
        .iter()
        .filter_map(|def| match &def.placement {
            Placement::Unsupported {
                why: Unsupported::RingWorld,
            } => None,
            Placement::Unsupported { why } => Some(mega_row(def, Some(unsupported_why(why)))),
            _ => None,
        })
        .collect()
}

fn unsupported_why(why: &Unsupported) -> String {
    match why {
        Unsupported::Bypass { bypass } => format!("stands for the bypass {bypass}"),
        Unsupported::RingWorld => "a stage of a ring world".to_owned(),
        Unsupported::BecomesStarbase => "building it makes a starbase".to_owned(),
        Unsupported::ChangesBody => "changes its planet in a way that cannot be told".to_owned(),
        Unsupported::FixedClass { class } => {
            format!("makes its planet {class}, a class Galaxy Forge gives no planet")
        }
        Unsupported::WholeStructure { .. } => {
            "part of a structure of several rows or planets".to_owned()
        }
    }
}

/// The first stages of the families the add dialog holds back that the playset defines.
fn held_back(gd: &GameData) -> Vec<Row> {
    NOT_OFFERED_YET
        .iter()
        .filter_map(|key| gd.megastructures.get(key))
        .map(|def| mega_row(def, None))
        .collect()
}

/// Each effect a construction keeps that its walk cannot place, once, on the first type in
/// key order that meets it: every later stage of a chain meets its earlier stages' too, and
/// many stages call the same scripted effects. Each line names the stage it runs in first.
fn unfollowed(gd: &GameData) -> Vec<Row> {
    let mut seen = BTreeSet::new();
    let mut rows = Vec::new();
    for def in gd.megastructures.iter() {
        for line in &def.construction.unfollowed {
            let effect = line
                .what
                .split_once(": ")
                .map_or(&line.what[..], |(_, rest)| rest);
            if seen.insert(effect) {
                rows.push(mega_row(def, Some(line.what.clone())));
            }
        }
    }
    rows
}

/// Each ring world site whose chain lays out no ring of finished quadrants the editor can
/// add, with the reason.
fn rings_failing(gd: &GameData) -> Vec<Row> {
    let sites = gd.megastructures.iter().filter(|def| {
        def.ring_world
            && !matches!(
                def.placement,
                Placement::Unsupported {
                    why: Unsupported::RingWorld
                }
            )
    });
    sites
        .filter_map(|def| {
            let reason = match quadrants(gd, &def.key) {
                None => "no stage of its chain spawns more than one row".to_owned(),
                Some(count) => {
                    let stages = vec![RingStage::Finished; count];
                    ring_world(gd, &def.key, &stages, None, &[]).err()?
                }
            };
            Some(mega_row(def, Some(reason)))
        })
        .collect()
}

/// A megastructure type's row.
fn mega_row(def: &MegastructureDef, detail: Option<String>) -> Row {
    row(&def.key, def.source.clone(), detail)
}

/// The texture key the app's `bodyLook` draws a body of `pc` from, or `None` for a class it
/// draws without one: a star that only `rings` holds, an asteroid, a flat class, a class
/// whose model draws nothing or the astral scar.
fn disc_key(gd: &GameData, pc: &PlanetClassDef, rings: &BTreeSet<&str>) -> Option<String> {
    let class = pc.key.clone();
    let key = if pc.star {
        if rings.contains(pc.key.as_str()) {
            return None;
        }
        TextureKey::StarDisc { class }
    } else if pc.asteroid || pc.astral_scar || pc.hidden_model || gd.flat_art(&class) {
        return None;
    } else if gd.shattered(&class) {
        TextureKey::ShatteredDisc {
            class,
            seed: SHATTERED_SEED,
        }
    } else {
        TextureKey::PlanetDisc { class }
    };
    Some(key.to_string())
}

/// The star bodies that only black-hole systems hold, which the app draws as a ring rather
/// than a disc (its `starGlyph`).
fn ring_bodies(gd: &GameData) -> BTreeSet<&str> {
    let ring = |star_class: &str| {
        let sc = star_class.to_ascii_lowercase();
        sc.starts_with("sc_black_hole") && !sc.contains("binary") && !sc.contains("trinary")
    };
    let (mut ringed, mut lit) = (BTreeSet::new(), BTreeSet::new());
    for sc in gd.star_classes.iter() {
        let bodies = if ring(&sc.key) { &mut ringed } else { &mut lit };
        bodies.extend(sc.planet_keys());
    }
    &ringed - &lit
}

/// `f` of each of `items`, in order, the items shared out among the machine's cores.
pub(crate) fn on_every_core<T: Sync, R: Send>(items: &[T], f: impl Fn(&T) -> R + Sync) -> Vec<R> {
    let cores = std::thread::available_parallelism().map_or(1, NonZero::get);
    let share = items.len().div_ceil(cores).max(1);
    let f = &f;
    std::thread::scope(|scope| {
        let workers: Vec<_> = items
            .chunks(share)
            .map(|part| scope.spawn(move || part.iter().map(f).collect::<Vec<_>>()))
            .collect();
        workers
            .into_iter()
            .flat_map(|worker| {
                worker
                    .join()
                    .unwrap_or_else(|e| std::panic::resume_unwind(e))
            })
            .collect()
    })
}

/// A class's row, `source` being its mod, or `None` for the base game.
fn row(key: &str, source: Option<String>, detail: Option<String>) -> Row {
    Row {
        key: key.to_owned(),
        source: source.unwrap_or_else(|| VANILLA.to_owned()),
        detail,
    }
}

fn diagnostic_source(gd: &GameData, d: &Diagnostic) -> String {
    match d {
        Diagnostic::ParseError { file, .. }
        | Diagnostic::Unreadable { file, .. }
        | Diagnostic::GameDataPathIgnored { file, .. } => layer_name(gd, file),
        Diagnostic::ModMissing { name, .. } => name.clone(),
        Diagnostic::Override { to, .. } => layer_name(gd, to),
        Diagnostic::RebuildFailed { .. } | Diagnostic::NoPlayset { .. } => "-".to_owned(),
    }
}

fn layer_name(gd: &GameData, file: &Path) -> String {
    gd.layout
        .layer_of(file)
        .map_or_else(|| "-".to_owned(), |(layer, _)| layer.name.clone())
}
