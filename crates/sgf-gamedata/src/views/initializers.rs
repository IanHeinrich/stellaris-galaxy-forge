use serde::{Deserialize, Serialize};
use sgf_core::format::save::details::SourceLine;
use ts_rs::TS;

use crate::GameData;
use crate::details;
use crate::initializers::{
    BodyClass, InitPlanet, Initializer, SpawnedCountry, body_size, source_line,
};
use crate::install::script::{self, line_of, whole};
use crate::scripts::identity;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct InitPlanetView {
    pub name: Option<String>,
    pub class: String,
    /// `(min, max)`, equal for a fixed size. The block's own size, else its class's.
    pub size: Option<(u32, u32)>,
    pub orbit_distance: Option<f64>,
    /// `None` when the game rolls the ring: the block states none and its class can roll one.
    pub has_ring: Option<bool>,
    pub count: u32,
    pub home_planet: bool,
    pub deposits: Vec<String>,
    pub moons: Vec<InitPlanetView>,
}

impl InitPlanetView {
    fn new(p: &InitPlanet, moon: bool, gd: &GameData) -> Self {
        let class = match &p.class {
            BodyClass::Named(key) => gd.planet_classes.get(key),
            BodyClass::Star | BodyClass::Random(_) => None,
        };
        Self {
            name: p.name.clone(),
            class: p.class.written().to_owned(),
            size: body_size(Some(p), class, moon).map(|range| (whole(range.min), whole(range.max))),
            orbit_distance: p.orbit(),
            has_ring: gd.ring(p, moon),
            count: p.instances(),
            home_planet: p.home_planet,
            deposits: p.deposits.clone(),
            moons: bodies(&p.moons).map(|m| Self::new(m, true, gd)).collect(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct InitializerView {
    pub name: String,
    /// The definition file it was read from.
    pub source: String,
    /// A localisation key the app resolves; most initializers name none.
    pub display_name: Option<String>,
    pub class: Option<String>,
    /// The star class a scenario system with this initializer is drawn as: `class`, or a
    /// G star when that is a random list or missing, since the game draws that star only
    /// when it generates the galaxy.
    pub star_class: String,
    pub usage: Option<String>,
    /// Its `usage` is one a country starts in, so it needs a `spawn_weight`.
    pub empire_spawn: bool,
    pub max_instances: Option<u32>,
    pub flags: Vec<String>,
    /// The countries its `init_effect` creates.
    pub countries: Vec<SpawnedCountry>,
    pub spawns: Vec<String>,
    pub planets: Vec<InitPlanetView>,
    /// Every body `planets` spawns, moons included.
    pub planet_count: u32,
}

impl InitializerView {
    pub fn new(i: &Initializer, gd: &GameData) -> Self {
        Self {
            name: i.name.clone(),
            source: i.source.display().to_string(),
            display_name: i.display_name.clone(),
            class: i.class.clone(),
            star_class: details::star_class_of(Some(i)).to_owned(),
            usage: i.usage.clone(),
            empire_spawn: identity::is_empire_spawn(i.usage.as_deref()),
            max_instances: i.max_instances,
            flags: i.flags.clone(),
            countries: i.countries.clone(),
            spawns: i.spawns.clone(),
            planets: bodies(&i.planets)
                .map(|p| InitPlanetView::new(p, false, gd))
                .collect(),
            planet_count: i.planets.iter().map(InitPlanet::total).sum(),
        }
    }
}

/// The blocks of `blocks` that place a body: a spacer places none.
fn bodies(blocks: &[InitPlanet]) -> impl Iterator<Item = &InitPlanet> {
    blocks.iter().filter(|b| !b.spacer())
}

/// An initializer's definition as the file that won it writes it, from its key to its closing
/// brace, with each `inline_script` call left as written.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct InitializerDefinition {
    pub name: String,
    pub text: String,
    /// The file, and the line its key is on.
    pub at: SourceLine,
    /// Each `inline_script` statement of the text, at any depth, in order.
    pub inline_scripts: Vec<InlineScriptCall>,
}

/// One `inline_script` statement of a definition's text.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct InlineScriptCall {
    /// The line of the text it starts on, from 1.
    pub line: u32,
    /// Its `script`, the path under `common/inline_scripts` without `.txt`.
    pub script: String,
    /// The script's file at its first statement. `None` when the loaded game data has no such
    /// script.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub file: Option<SourceLine>,
}

impl InitializerDefinition {
    /// `name`'s definition; `None` when the loaded game data defines no such initializer.
    pub fn read(gd: &GameData, name: &str) -> Option<Self> {
        let def = gd.initializers.def(name)?;
        let src = &def.src;
        let span = def.node.span();
        let first = line_of(src, span.start);
        let mut calls = Vec::new();
        script::find_deep(&def.node, "inline_script", src, &mut calls);
        let inline_scripts = calls
            .into_iter()
            .filter_map(|call| {
                let script = call
                    .scalar_str(src)
                    .or_else(|| call.find("script", src)?.scalar_str(src))?;
                Some(InlineScriptCall {
                    line: line_of(src, call.span().start) - first + 1,
                    script: script.to_owned(),
                    file: script_file(gd, script),
                })
            })
            .collect();
        Some(Self {
            name: name.to_owned(),
            text: String::from_utf8_lossy(span.slice(src)).into_owned(),
            at: source_line(&def.file, first),
            inline_scripts,
        })
    }
}

/// The file of inline script `script`, at its first line that is neither blank nor a comment.
fn script_file(gd: &GameData, script: &str) -> Option<SourceLine> {
    let file = gd
        .layout
        .resolve_file(&format!("common/inline_scripts/{script}.txt"))?;
    let text = std::fs::read(&file).unwrap_or_default();
    let line = text
        .split(|&b| b == b'\n')
        .position(|line| {
            let line = line.trim_ascii();
            !line.is_empty() && !line.starts_with(b"#")
        })
        .map_or(1, |index| u32::try_from(index + 1).unwrap_or(u32::MAX));
    Some(source_line(&file, line))
}
