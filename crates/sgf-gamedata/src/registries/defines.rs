//! `common/defines`: the `NGraphics` constants the map uses to draw territory
//! borders, their names and moons, and the `NGameplay` ones that set how many deposits a new body rolls
//! and how far out a system's inner and outer radii lie.

use sgf_core::cst::Node;
use sgf_core::ops::SystemRadii;

use crate::install::script::ParsedDir;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BorderDefines {
    pub system_radius: f64,
    pub hyperlane_thickness: f64,
    /// `NGraphics.BORDER_INFLUENCE_MAX_DISTANCE_FACTOR`: how far an owned system or lane
    /// reaches, in multiples of its radius or thickness.
    pub influence_max_distance_factor: f64,
    /// `NGraphics.BORDER_OWNERLESS_SYSTEM_RADIUS`: an unowned system's radius.
    pub ownerless_system_radius: f64,
    /// `NGraphics.BORDER_OWNERLESS_HYPERLANE_THICKNESS`: the thickness of a lane between two
    /// unowned systems.
    pub ownerless_hyperlane_thickness: f64,
    /// `NGraphics.BORDER_OWNERLESS_INFLUENCE_MAX_DISTANCE_FACTOR`: how far an unowned system or
    /// lane reaches.
    pub ownerless_influence_max_distance_factor: f64,
    /// `NGraphics.MOON_SCALE`: how much smaller the map draws a moon than a planet of the same
    /// `planet_size`.
    pub moon_scale: f64,
    /// `NGraphics.MAPNAME_BORDER_MIN_SIZE`: the narrowest an empire's name is written on the
    /// map, in world units, however small its territory.
    pub name_min_width: f64,
}

impl Default for BorderDefines {
    fn default() -> Self {
        Self {
            system_radius: 35.0,
            hyperlane_thickness: 20.0,
            influence_max_distance_factor: 1.88,
            ownerless_system_radius: 30.0,
            ownerless_hyperlane_thickness: 20.0,
            ownerless_influence_max_distance_factor: 1.88,
            moon_scale: 0.7,
            name_min_width: 100.0,
        }
    }
}

impl BorderDefines {
    /// Every file under `common/defines` in order, a later value replacing an earlier one.
    pub(crate) fn load(files: &ParsedDir) -> Self {
        let mut out = Self::default();
        for (root, src) in files.roots() {
            for graphics in root.find_all("NGraphics", src) {
                for (target, key) in [
                    (&mut out.system_radius, "BORDER_SYSTEM_RADIUS"),
                    (&mut out.hyperlane_thickness, "BORDER_HYPERLANE_THICKNESS"),
                    (
                        &mut out.influence_max_distance_factor,
                        "BORDER_INFLUENCE_MAX_DISTANCE_FACTOR",
                    ),
                    (
                        &mut out.ownerless_system_radius,
                        "BORDER_OWNERLESS_SYSTEM_RADIUS",
                    ),
                    (
                        &mut out.ownerless_hyperlane_thickness,
                        "BORDER_OWNERLESS_HYPERLANE_THICKNESS",
                    ),
                    (
                        &mut out.ownerless_influence_max_distance_factor,
                        "BORDER_OWNERLESS_INFLUENCE_MAX_DISTANCE_FACTOR",
                    ),
                    (&mut out.moon_scale, "MOON_SCALE"),
                    (&mut out.name_min_width, "MAPNAME_BORDER_MIN_SIZE"),
                ] {
                    if let Some(n) = field(graphics, key, src) {
                        *target = n;
                    }
                }
            }
        }
        out
    }
}

/// `NGameplay`'s `SYSTEM_MIN_INNER_RADIUS`, `SYSTEM_INNER_RADIUS_OFFSET` and
/// `SYSTEM_OUTER_RADIUS_OFFSET`, a later value replacing an earlier one and vanilla's
/// standing for any no file gives.
pub(crate) fn system_radii(files: &ParsedDir) -> SystemRadii {
    let mut out = SystemRadii::VANILLA;
    for (root, src) in files.roots() {
        for gameplay in root.find_all("NGameplay", src) {
            for (target, key) in [
                (&mut out.min_inner, "SYSTEM_MIN_INNER_RADIUS"),
                (&mut out.inner_offset, "SYSTEM_INNER_RADIUS_OFFSET"),
                (&mut out.outer_offset, "SYSTEM_OUTER_RADIUS_OFFSET"),
            ] {
                if let Some(n) = field(gameplay, key, src) {
                    *target = n;
                }
            }
        }
    }
    out
}

fn field(node: &Node, key: &str, src: &[u8]) -> Option<f64> {
    node.find(key, src)?.scalar_str(src)?.parse().ok()
}

/// `NGameplay`: how many deposits a new body rolls, and the Resource Abundance range.
/// Every file under `common/defines` is read in order, a later value replacing an earlier
/// one, since a mod changes a define by writing it again in a file of its own.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DepositDefines {
    pub min_blocked: f64,
    pub min_unblocked: f64,
    pub colony: DepositCounts,
    pub non_colony: DepositCounts,
    pub abundance_default: f64,
    pub abundance_max: f64,
}

/// `*_DEPOSITS_FIXED_BASE` and friends for one kind of body.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DepositCounts {
    pub fixed_base: f64,
    pub random_base: f64,
    pub fixed_from_size: f64,
    pub random_from_size: f64,
}

impl DepositCounts {
    /// How many draws a body of `size` gets.
    pub fn draws(self, size: f64) -> usize {
        floor(
            self.fixed_base
                + self.random_base
                + (self.fixed_from_size + self.random_from_size) * size,
        )
    }

    /// How many deposits a body of `size` is topped up to.
    pub fn minimum(self, size: f64) -> usize {
        floor(self.fixed_base + self.fixed_from_size * size)
    }
}

fn floor(n: f64) -> usize {
    n.floor().max(0.0) as usize
}

impl Default for DepositDefines {
    fn default() -> Self {
        Self {
            min_blocked: 1.0,
            min_unblocked: 3.0,
            colony: DepositCounts {
                fixed_base: 5.0,
                random_base: 2.0,
                fixed_from_size: 0.2,
                random_from_size: 0.2,
            },
            non_colony: DepositCounts {
                fixed_base: 1.0,
                random_base: 0.0,
                fixed_from_size: 0.0,
                random_from_size: 0.0,
            },
            abundance_default: 2.0,
            abundance_max: 5.0,
        }
    }
}

impl DepositDefines {
    pub(crate) fn load(files: &ParsedDir) -> Self {
        let mut out = Self::default();
        for (root, src) in files.roots() {
            for gameplay in root.find_all("NGameplay", src) {
                out.read(gameplay, src);
            }
        }
        out
    }

    /// The factor a save's `galaxy.resource_abundance` gives, the default when it has none.
    pub fn abundance(&self, saved: Option<f64>) -> f64 {
        saved.unwrap_or(self.abundance_default)
    }

    fn read(&mut self, node: &Node, src: &[u8]) {
        let set = |target: &mut f64, key: &str| {
            if let Some(n) = field(node, key, src) {
                *target = n;
            }
        };
        set(&mut self.min_blocked, "MIN_BLOCKED_DEPOSITS");
        set(&mut self.min_unblocked, "MIN_UNBLOCKED_DEPOSITS");
        for (counts, prefix) in [
            (&mut self.colony, "COLONY"),
            (&mut self.non_colony, "NON_COLONY"),
        ] {
            set(
                &mut counts.fixed_base,
                &format!("{prefix}_DEPOSITS_FIXED_BASE"),
            );
            set(
                &mut counts.random_base,
                &format!("{prefix}_DEPOSITS_RANDOM_BASE"),
            );
            set(
                &mut counts.fixed_from_size,
                &format!("{prefix}_DEPOSITS_FIXED_FROM_SIZE"),
            );
            set(
                &mut counts.random_from_size,
                &format!("{prefix}_DEPOSITS_RANDOM_FROM_SIZE"),
            );
        }
        set(&mut self.abundance_default, "RESOURCE_ABUNDANCE_DEFAULT");
        set(&mut self.abundance_max, "RESOURCE_ABUNDANCE_MAX");
    }
}
