//! `sgf texture`: decode one game texture by key to a PNG.

use std::path::Path;

use sgf_gamedata::LoadOptions;
use sgf_gamedata::textures::{TextureKey, Textures};

use super::{Outcome, Run};

pub fn run(key: &str, out: &Path, opts: &LoadOptions) -> Run {
    key.parse::<TextureKey>()?;
    let gd = super::game_data(opts)?;
    let png = gd.texture_png(&Textures::new(None), key)?;
    std::fs::write(out, &png)?;
    println!("{key}: {} bytes written to {}", png.len(), out.display());
    Ok(Outcome::Ok)
}
