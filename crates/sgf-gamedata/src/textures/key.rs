//! The texture key grammar: parsing and formatting `TextureKey`.

use std::fmt;
use std::str::FromStr;

use super::TextureError;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TextureKey {
    StarClass {
        icon: String,
    },
    /// Deposit art under `gfx/interface/icons/deposits/`, `.dds` left off; at most one
    /// folder deep (`unused/d_strategic_resources`).
    Deposit {
        icon: String,
    },
    /// An icon under `gfx/interface/icons/`, named by its path (`planet_modifiers/pm_x.dds`).
    Icon {
        path: String,
    },
    Flag {
        category: String,
        file: String,
    },
    /// A flag icon as the game draws it on the map: its alpha in solid white.
    Symbol {
        category: String,
        file: String,
    },
    Sprite {
        name: String,
        frame: Option<u32>,
    },
    EmpireFlag {
        background: String,
        icon_category: String,
        icon_file: String,
        colours: [String; 4],
    },
    /// A planet class's surface map baked into a lit disc.
    PlanetDisc {
        class: String,
    },
    /// The texture of the game's gas giant ring mesh.
    PlanetRing,
    /// A star planet class's sphere baked as the system view shows it.
    StarDisc {
        class: String,
    },
}

impl TextureKey {
    /// Deposit art by its icon name; `None` for a name the key grammar refuses.
    pub fn deposit(icon: &str) -> Option<Self> {
        relative_path(icon, 2).map(|icon| Self::Deposit { icon })
    }

    /// An icon by its `.dds` path under `gfx/interface/icons/`.
    pub fn icon(path: &str) -> Option<Self> {
        relative_path(path, usize::MAX)
            .filter(|p| p.ends_with(".dds"))
            .map(|path| Self::Icon { path })
    }

    /// A `GFX_` sprite, or one frame of it, counted from 1.
    pub fn sprite(name: &str, frame: Option<u32>) -> Option<Self> {
        if frame == Some(0) {
            return None;
        }
        component(name).map(|name| Self::Sprite { name, frame })
    }
}

impl FromStr for TextureKey {
    type Err = TextureError;

    fn from_str(s: &str) -> Result<Self, TextureError> {
        let bad = || TextureError::BadKey(s.to_owned());
        if s == "planet_ring" {
            return Ok(Self::PlanetRing);
        }
        let (kind, rest) = s.split_once(':').ok_or_else(bad)?;
        let key = match kind {
            "star_class" => Self::StarClass {
                icon: component(rest).ok_or_else(bad)?,
            },
            "deposit" => Self::Deposit {
                icon: relative_path(rest, 2).ok_or_else(bad)?,
            },
            "icon" => Self::Icon {
                path: relative_path(rest, usize::MAX)
                    .filter(|p| p.ends_with(".dds"))
                    .ok_or_else(bad)?,
            },
            "flag" => {
                let (category, file) = split_file(rest).ok_or_else(bad)?;
                Self::Flag { category, file }
            }
            "symbol" => {
                let (category, file) = split_file(rest).ok_or_else(bad)?;
                Self::Symbol { category, file }
            }
            "sprite" => {
                let (name, frame) = match rest.split_once('#') {
                    Some((name, frame)) => (name, Some(frame.parse().ok().filter(|f| *f >= 1))),
                    None => (rest, None),
                };
                Self::Sprite {
                    name: component(name).ok_or_else(bad)?,
                    frame: frame.map(|f| f.ok_or_else(bad)).transpose()?,
                }
            }
            "empire_flag" => {
                let mut parts = rest.splitn(3, ':');
                let background = parts.next().and_then(component).ok_or_else(bad)?;
                let (icon_category, icon_file) =
                    parts.next().and_then(split_file).ok_or_else(bad)?;
                let colours: Vec<String> = parts
                    .next()
                    .ok_or_else(bad)?
                    .split(',')
                    .map(|c| colour_name(c).ok_or_else(bad))
                    .collect::<Result<_, _>>()?;
                Self::EmpireFlag {
                    background,
                    icon_category,
                    icon_file,
                    colours: colours.try_into().map_err(|_| bad())?,
                }
            }
            "planet_disc" => Self::PlanetDisc {
                class: component(rest).ok_or_else(bad)?,
            },
            "star_disc" => Self::StarDisc {
                class: component(rest).ok_or_else(bad)?,
            },
            _ => return Err(bad()),
        };
        Ok(key)
    }
}

impl fmt::Display for TextureKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::StarClass { icon } => write!(f, "star_class:{icon}"),
            Self::Deposit { icon } => write!(f, "deposit:{icon}"),
            Self::Icon { path } => write!(f, "icon:{path}"),
            Self::Flag { category, file } => write!(f, "flag:{category}/{file}"),
            Self::Symbol { category, file } => write!(f, "symbol:{category}/{file}"),
            Self::Sprite { name, frame: None } => write!(f, "sprite:{name}"),
            Self::Sprite {
                name,
                frame: Some(frame),
            } => write!(f, "sprite:{name}#{frame}"),
            Self::EmpireFlag {
                background,
                icon_category,
                icon_file,
                colours,
            } => write!(
                f,
                "empire_flag:{background}:{icon_category}/{icon_file}:{}",
                colours.join(",")
            ),
            Self::PlanetDisc { class } => write!(f, "planet_disc:{class}"),
            Self::PlanetRing => f.write_str("planet_ring"),
            Self::StarDisc { class } => write!(f, "star_disc:{class}"),
        }
    }
}

/// One path segment: non-empty, no separators, no `..`.
fn component(s: &str) -> Option<String> {
    let clean = s != ".." && !s.contains(['/', '\\', '#']) && colour_name(s).is_some();
    clean.then(|| s.to_owned())
}

/// A colour name or `#rrggbb`: non-empty, none of the key's own separators.
fn colour_name(s: &str) -> Option<String> {
    let clean = !s.is_empty() && !s.contains([':', ',']) && !s.chars().any(char::is_control);
    clean.then(|| s.to_owned())
}

/// Up to `max_parts` `/`-separated path segments, each a [`component`] that does not end
/// in a dot or a space (Windows trims those, so `.. ` would be `..`), so the path stays
/// below the folder the key kind names.
fn relative_path(s: &str, max_parts: usize) -> Option<String> {
    let parts: Vec<&str> = s.split('/').collect();
    let clean = parts.len() <= max_parts
        && parts
            .iter()
            .all(|part| !part.ends_with(['.', ' ']) && component(part).is_some());
    clean.then(|| s.to_owned())
}

fn split_file(s: &str) -> Option<(String, String)> {
    let (category, file) = s.split_once('/')?;
    Some((component(category)?, component(file)?))
}
