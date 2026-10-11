//! Bakes model sprites from the Stellaris install, mods left out, into PNGs for review.
//!
//! cargo run -p sgf-gamedata --release --example bake_model -- <out_dir> <culture>:<entity>...

use std::fs;
use std::path::PathBuf;
use std::time::Instant;

use base64::prelude::*;
use sgf_gamedata::LoadOptions;
use sgf_gamedata::textures::Textures;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let out = PathBuf::from(
        args.next()
            .ok_or("usage: bake_model <out_dir> <culture>:<entity>...")?,
    );
    fs::create_dir_all(&out)?;
    let opts = LoadOptions {
        mods: false,
        ..LoadOptions::default()
    };
    let gd = sgf_gamedata::load(&opts, &mut |_| {})?;
    let cache = tempfile::tempdir()?;
    let textures = Textures::new(Some(cache.path().to_path_buf()));
    for model in args {
        let key = format!("model:{model}");
        let started = Instant::now();
        let view = gd.texture(&textures, &key);
        let took = started.elapsed();
        let started = Instant::now();
        gd.texture(&textures, &key);
        let cached = started.elapsed();
        let (Some(png), Some(placement)) = (&view.png_base64, view.model) else {
            println!("{key}: {}", view.error.unwrap_or_default());
            continue;
        };
        let file = out.join(format!("{}.png", model.replace(':', "_")));
        fs::write(&file, BASE64_STANDARD.decode(png)?)?;
        let [x, y, up] = gd.model_bounds(&textures, &key)?.size();
        println!(
            "{key}: {}x{} px, sprite {:.2} x {:.2} save units, origin at ({:.3}, {:.3}), \
             model {x:.2} wide (save x) x {y:.2} long (save y) x {up:.2} tall, baked in {took:.2?}, cached in {cached:.2?}, {}",
            view.width,
            view.height,
            placement.width,
            placement.height,
            placement.anchor_x,
            placement.anchor_y,
            file.display(),
        );
    }
    Ok(())
}
