#![allow(dead_code)]

pub mod layouts;
pub mod scripts;

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

use image::RgbaImage;
use tempfile::TempDir;

use sgf_core::document::Document;
use sgf_core::session::Session;
use sgf_gamedata::install::discovery::find_install;
use sgf_gamedata::{GameData, LoadOptions, Phase};

pub const SAMPLE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../testdata/4.4-early.sav");
pub const SAMPLE_4_5: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../testdata/4.5-day-one.sav"
);

/// Free ground beside the player's home system 169, where the spike's system stood.
pub const SPOT: (f64, f64) = (-292.23404, -137.62265);
/// The Resource Abundance both sample saves were generated with.
pub const ABUNDANCE: f64 = 2.0;

static SAMPLE_DOCUMENT: LazyLock<Document> =
    LazyLock::new(|| Document::load(SAMPLE).expect("load the 4.4 sample"));
static SAMPLE_4_5_DOCUMENT: LazyLock<Document> =
    LazyLock::new(|| Document::load(SAMPLE_4_5).expect("load the 4.5 sample"));

/// The 4.4 sample, read and indexed once per binary. Each call gets a session of its own.
pub fn open_4_4() -> Session {
    Session::from_document(Some(PathBuf::from(SAMPLE)), SAMPLE_DOCUMENT.clone())
        .expect("open the 4.4 sample")
}

/// The 4.5 sample, read and indexed once per binary. Each call gets a session of its own.
pub fn open_4_5() -> Session {
    Session::from_document(Some(PathBuf::from(SAMPLE_4_5)), SAMPLE_4_5_DOCUMENT.clone())
        .expect("open the 4.5 sample")
}

/// The 4.5 sample with `edit` applied to its gamestate, as a session with no path.
pub fn open_4_5_edited(edit: impl FnOnce(&mut String)) -> Session {
    let original = SAMPLE_4_5_DOCUMENT.original().to_vec();
    let mut gamestate = String::from_utf8(original).expect("utf-8");
    edit(&mut gamestate);
    let meta = SAMPLE_4_5_DOCUMENT.meta().to_vec();
    let doc = Document::from_bytes(gamestate.into_bytes(), meta).expect("index the edit");
    Session::from_document(None, doc).expect("project the edit")
}

/// A choice a planet's page offers, which [`by_key`] finds by the key it is filed under.
pub trait Keyed {
    fn key(&self) -> &str;
}

impl Keyed for sgf_gamedata::anomaly_choices::AnomalyChoice {
    fn key(&self) -> &str {
        &self.key
    }
}

impl Keyed for sgf_gamedata::deposit_choices::DepositChoice {
    fn key(&self) -> &str {
        &self.key
    }
}

impl Keyed for sgf_gamedata::dig_site_choices::DigSiteChoice {
    fn key(&self) -> &str {
        &self.key
    }
}

/// The item of `items` filed under `key`; the test fails if there is none.
pub fn by_key<'a, T: Keyed>(items: &'a [T], key: &str) -> &'a T {
    items
        .iter()
        .find(|item| item.key() == key)
        .unwrap_or_else(|| panic!("{key} is offered"))
}

pub fn fixture(rel: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(rel)
}

/// The synthetic install with its two loadable mods and one missing one.
pub fn load_fixture(mods: bool) -> GameData {
    let opts = LoadOptions {
        install: Some(fixture("install")),
        user_dir: Some(fixture("userdata")),
        language: "english".to_owned(),
        mods,
    };
    let mut phases = Vec::new();
    let gd = sgf_gamedata::load(&opts, &mut |p| phases.push(p)).expect("fixture loads");
    assert_eq!(
        phases,
        [Phase::Discover, Phase::Definitions, Phase::Localisation]
    );
    gd
}

/// The synthetic install without mods, parsed once and shared by every test
/// that only reads it. Tests that need different `LoadOptions` call
/// [`load_fixture`] directly for a fresh load.
pub fn cached_fixture() -> &'static GameData {
    static FIXTURE: LazyLock<GameData> = LazyLock::new(|| load_fixture(false));
    &FIXTURE
}

/// The synthetic install with its mod layer, parsed once and shared by
/// every test that only reads it.
pub fn cached_fixture_with_mods() -> &'static GameData {
    static FIXTURE: LazyLock<GameData> = LazyLock::new(|| load_fixture(true));
    &FIXTURE
}

/// `files`, each a path under the install and its text, written into a temporary install
/// and loaded vanilla. The install lasts as long as the returned directory. A file that
/// supplies no localisation gets the stub `localisation/english/fx_l_english.yml` needs; a
/// caller writing its own leaves this one alone.
pub fn hand_written(files: &[(&str, &str)]) -> (TempDir, GameData) {
    let files: Vec<(&str, Vec<u8>)> = files
        .iter()
        .map(|&(rel, text)| (rel, text.as_bytes().to_vec()))
        .collect();
    hand_written_bytes(&files)
}

/// [`hand_written`], for install files that are not text: a `.dds`, generated with [`dds`] or
/// copied from a fixture.
pub fn hand_written_bytes(files: &[(&str, Vec<u8>)]) -> (TempDir, GameData) {
    let dir = tempfile::tempdir().expect("temp dir");
    let install = dir.path().join("install");
    for (rel, content) in files {
        let file = install.join(rel);
        fs::create_dir_all(file.parent().expect("a directory")).expect("the install tree");
        fs::write(file, content).expect("an install file");
    }
    let stub = install.join("localisation/english/fx_l_english.yml");
    if !stub.exists() {
        fs::create_dir_all(stub.parent().expect("a directory")).expect("the install tree");
        fs::write(stub, "l_english:\n").expect("the localisation stub");
    }
    let gd = load_tree(&install, Some(&dir.path().join("user")), false);
    (dir, gd)
}

/// An uncompressed 32-bit DDS of `faces` square images `side` texels wide, a cube map when
/// there are six, with a full mip chain down to 1×1 (each level a 2×2 box average of the one
/// before).
pub fn dds(side: u32, faces: &[Vec<[u8; 4]>]) -> Vec<u8> {
    let levels = side.ilog2() + 1;
    let mut bytes = dds_header(side, levels, faces.len() == 6);
    for face in faces {
        let mut level = face.clone();
        let mut level_side = side;
        for _ in 0..levels {
            bytes.extend(level.iter().flatten());
            if level_side == 1 {
                break;
            }
            level = box_downsample(&level, level_side);
            level_side /= 2;
        }
    }
    bytes
}

/// A one-face uncompressed 32-bit DDS `side` texels wide, its mip chain down to 1×1 each a
/// solid colour from `level_colour(level)`: for pinning which level a caller's `width` reads.
pub fn dds_by_level(side: u32, level_colour: impl Fn(u32) -> [u8; 4]) -> Vec<u8> {
    let levels = side.ilog2() + 1;
    let mut bytes = dds_header(side, levels, false);
    let mut level_side = side;
    for level in 0..levels {
        let colour = level_colour(level);
        bytes.extend((0..level_side * level_side).flat_map(|_| colour));
        level_side = (level_side / 2).max(1);
    }
    bytes
}

fn dds_header(side: u32, levels: u32, cube: bool) -> Vec<u8> {
    let mut header = [0u32; 31];
    header[0] = 124;
    header[1] = 0x1 | 0x2 | 0x4 | 0x1000 | 0x8 | 0x2_0000;
    header[2] = side;
    header[3] = side;
    header[4] = side * 4;
    header[6] = levels;
    header[18] = 32;
    header[19] = 0x41;
    header[21] = 32;
    header[22] = 0xff;
    header[23] = 0xff00;
    header[24] = 0xff_0000;
    header[25] = 0xff00_0000;
    header[26] = 0x1000 | 0x40_0000 | if cube { 0x8 } else { 0 };
    header[27] = if cube { 0x200 | 0xfc00 } else { 0 };
    let mut bytes = b"DDS ".to_vec();
    bytes.extend(header.iter().flat_map(|word| word.to_le_bytes()));
    bytes
}

/// `pixels`, `side` square, averaged 2×2 down to `side / 2` square.
fn box_downsample(pixels: &[[u8; 4]], side: u32) -> Vec<[u8; 4]> {
    let half = side / 2;
    (0..half)
        .flat_map(|y| (0..half).map(move |x| (x, y)))
        .map(|(x, y)| {
            let at = |dx: u32, dy: u32| pixels[((2 * y + dy) * side + 2 * x + dx) as usize];
            let corners = [at(0, 0), at(1, 0), at(0, 1), at(1, 1)];
            std::array::from_fn(|c| {
                (corners.iter().map(|p| u16::from(p[c])).sum::<u16>() / 4) as u8
            })
        })
        .collect()
}

/// The disc `key` (`planet_disc:<class>` or `star_disc:<class>`) bakes to, through the
/// texture cache.
pub fn bake_disc(gd: &GameData, key: &str) -> RgbaImage {
    let (_cache, textures) = temp_textures();
    let png = gd
        .texture_png(&textures, key)
        .unwrap_or_else(|e| panic!("{key}: {e}"));
    image::load_from_memory(&png).expect("a PNG").to_rgba8()
}

/// The install at `install` in English, with `user_dir` for its playset, whose mods load
/// when `mods` is set.
pub fn load_tree(install: &Path, user_dir: Option<&Path>, mods: bool) -> GameData {
    let opts = LoadOptions {
        install: Some(install.to_path_buf()),
        user_dir: user_dir.map(Path::to_path_buf),
        language: "english".to_owned(),
        mods,
    };
    sgf_gamedata::load(&opts, &mut |_| {}).expect("the install tree loads")
}

/// Write a playset into `user_dir` that enables `mods` in order, each a folder name and
/// its files: a path under the mod root and the text to write there.
pub fn playset(user_dir: &Path, mods: &[(&str, &[(&str, &str)])]) {
    for (name, files) in mods {
        add_mod(user_dir, name, files);
    }
    let names: Vec<&str> = mods.iter().map(|(name, _)| *name).collect();
    enable(user_dir, &names);
}

/// A mod folder `name` under `user_dir`, with its descriptor and `files`; returns its root.
pub fn add_mod(user_dir: &Path, name: &str, files: &[(&str, &str)]) -> PathBuf {
    let root = user_dir.join("mod").join(name);
    fs::create_dir_all(&root).expect("mod tree");
    fs::write(
        user_dir.join("mod").join(format!("{name}.mod")),
        format!("name=\"{name}\"\npath=\"mod/{name}\"\nsupported_version=\"v9.9.*\"\n"),
    )
    .expect("descriptor");
    for (rel, text) in files {
        let file = root.join(rel);
        fs::create_dir_all(file.parent().expect("a directory")).expect("mod tree");
        fs::write(file, text).expect("mod file");
    }
    root
}

/// Make the mods named `mods` the playset, in order.
pub fn enable(user_dir: &Path, mods: &[&str]) {
    let enabled: Vec<String> = mods.iter().map(|m| format!("\"mod/{m}.mod\"")).collect();
    fs::write(
        user_dir.join("dlc_load.json"),
        format!(
            "{{\"disabled_dlcs\":[],\"enabled_mods\":[{}]}}",
            enabled.join(",")
        ),
    )
    .expect("dlc_load");
}

/// Whether this machine has a Stellaris install. Without one the tests that
/// need it return green, which is what happens on CI; `SGF_REQUIRE_INSTALL`
/// turns that skip into a failure.
pub fn have_install() -> bool {
    if find_install(None).is_ok() {
        return true;
    }
    let required = std::env::var_os("SGF_REQUIRE_INSTALL").is_some_and(|v| !v.is_empty());
    assert!(
        !required,
        "SGF_REQUIRE_INSTALL is set and no Stellaris install was found: \
         the tests that read one would have asserted nothing",
    );
    false
}

/// The real Stellaris install, vanilla only, read once for the whole test binary. `None`,
/// with a message, when this machine has none.
pub static INSTALL: LazyLock<Option<GameData>> = LazyLock::new(load_real);

fn load_real() -> Option<GameData> {
    if !have_install() {
        eprintln!("skipped: no Stellaris install");
        return None;
    }
    let opts = LoadOptions {
        mods: false,
        ..LoadOptions::default()
    };
    Some(sgf_gamedata::load(&opts, &mut |_| {}).expect("the real install loads"))
}

/// Runs `f(i)` for every `i` in `0..n` on its own thread and returns the results in order. A
/// panic in any thread resumes on the caller's, so it still fails the test and its message
/// still reaches the output.
pub fn parallel<R: Send>(n: usize, f: impl Fn(usize) -> R + Sync) -> Vec<R> {
    let f = &f;
    std::thread::scope(|scope| {
        (0..n)
            .map(|i| scope.spawn(move || f(i)))
            .collect::<Vec<_>>()
            .into_iter()
            .map(|handle| {
                handle
                    .join()
                    .unwrap_or_else(|e| std::panic::resume_unwind(e))
            })
            .collect()
    })
}

/// A texture cache in a temporary directory, which lasts as long as the returned handle.
pub fn temp_textures() -> (TempDir, sgf_gamedata::textures::Textures) {
    let dir = tempfile::tempdir().expect("temp dir");
    let textures = sgf_gamedata::textures::Textures::new(Some(dir.path().join("cache")));
    (dir, textures)
}
