//! Localisation on the synthetic install: the line format, layering,
//! `replace/`, references and markup.

mod common;

use sgf_core::projections::name::{NameTemplate, NameVariable};
use sgf_gamedata::{LoadOptions, Localisation};

use common::fixture;

#[test]
fn reads_resolves_and_strips_markup() {
    let gd = common::cached_fixture();
    assert_eq!(gd.loc.language, "english");
    assert!(!gd.loc.fell_back);
    assert_eq!(gd.loc.len(), 50);
    assert_eq!(gd.loc.raw("sc_sun"), Some("$pc_sun_star$"));
    let looped = gd
        .loc
        .get("loop_a")
        .expect("a looping reference still resolves");
    assert!(looped.starts_with('$'), "{looped}");
    assert!(
        gd.loc
            .get("ORD")
            .unwrap()
            .starts_with("n100+10+(0-9):$C$th")
    );

    let cases = [
        ("pc_sun_star", Some("Sun-class Star")),
        ("sc_ember", Some("Ember-class Star")),
        ("NAME_Lair", Some("The Lair")),
        ("quoted_inner", Some("the \"Echo Beacon,\" as dubbed")),
        ("l_english", None),
        ("missing_key", None),
        ("overridden_by_replace", Some("vanilla replace")),
        ("sc_sun", Some("Sun-class Star")),
        ("chain_a", Some("start middle end")),
        ("NAME_Beast", Some("Great Beast")),
        ("d_glow_1", Some("+1")),
        ("NAME_Traders", Some("Traders of")),
        ("HUMAN1_FLEET", Some("$ORD$ Fleet")),
        ("commented", Some("text")),
        ("escaped", Some("line one\nsays \"hi\"")),
    ];
    for (key, expected) in cases {
        assert_eq!(gd.loc.get(key).as_deref(), expected, "{key}");
    }
}

#[test]
fn later_layers_win_and_replace_files_win_over_all() {
    let gd = common::cached_fixture_with_mods();
    assert_eq!(gd.loc.get("vanilla_only").as_deref(), Some("still here"));
    assert_eq!(gd.loc.get("overridden_by_mod").as_deref(), Some("mod one"));
    assert_eq!(
        gd.loc.get("overridden_by_replace").as_deref(),
        Some("mod two replace")
    );
    assert_eq!(gd.loc.get("mod_one_only").as_deref(), Some("from mod one"));
    assert_eq!(
        gd.loc.get("mod_two_bare").as_deref(),
        Some("from a bare localisation folder")
    );

    let (normal, replace) = gd.layout.localisation_files("english");
    let names = |files: &[std::path::PathBuf]| -> Vec<String> {
        files
            .iter()
            .map(|p| p.file_name().unwrap().to_string_lossy().into_owned())
            .collect()
    };
    assert_eq!(
        names(&normal),
        [
            "a_l_english.yml",
            "misc_pf.yml",
            "one_l_english.yml",
            "two_bare_l_english.yml"
        ]
    );
    assert_eq!(names(&replace), ["z_l_english.yml", "two_l_english.yml"]);

    // A file named `_l_<lang>.yml` is taken at its name; any other `.yml` is opened and picked
    // by its `l_<lang>:` header: a mod file without the suffix counts, a German one does not.
    assert_eq!(gd.loc.get("NAME_pf_Zolqhast").as_deref(), Some("Zolqhast"));
    assert_eq!(gd.loc.get("german_in_english_folder"), None);
}

fn load_language(language: &str) -> sgf_gamedata::GameData {
    let opts = LoadOptions {
        install: Some(fixture("install")),
        user_dir: Some(fixture("userdata")),
        language: language.to_owned(),
        mods: false,
    };
    sgf_gamedata::load(&opts, &mut |_| {}).expect("loads")
}

#[test]
fn a_partial_language_falls_back_to_english_per_key() {
    let gd = load_language("german");
    assert!(!gd.loc.fell_back);
    assert_eq!(gd.loc.language, "german");
    assert_eq!(
        gd.loc.get("pc_sun_star").as_deref(),
        Some("Stern der Sonnenklasse")
    );
    assert_eq!(
        gd.loc.get("sc_sun").as_deref(),
        Some("Stern der Sonnenklasse")
    );
    assert_eq!(gd.loc.get("vanilla_only").as_deref(), Some("still here"));
}

#[test]
fn an_unknown_language_falls_back_to_english() {
    let gd = load_language("klingon");
    assert!(gd.loc.fell_back);
    assert_eq!(gd.loc.language, "klingon");
    assert_eq!(gd.loc.get("pc_sun_star").as_deref(), Some("Sun-class Star"));
}

fn plain(key: &str) -> NameTemplate {
    NameTemplate::plain(key)
}

fn literal(key: &str) -> NameTemplate {
    NameTemplate {
        key: key.to_owned(),
        literal: true,
        variables: Vec::new(),
    }
}

fn template(key: &str, variables: Vec<(&str, NameTemplate)>) -> NameTemplate {
    NameTemplate {
        key: key.to_owned(),
        literal: false,
        variables: variables
            .into_iter()
            .map(|(name, value)| NameVariable {
                name: name.to_owned(),
                value,
            })
            .collect(),
    }
}

/// `2200.04.08.sav`, fleet 424: a science ship of the Pious Caloctora Voyagers.
fn lum_lusolis() -> NameTemplate {
    template(
        "PREFIX_NAME_FORMAT",
        vec![
            ("NAME", plain("PLANT4_SHIP_LumLusolis")),
            (
                "PREFIX",
                template(
                    "%ACRONYM%",
                    vec![(
                        "base",
                        template(
                            "%ADJECTIVE%",
                            vec![
                                ("adjective", plain("SPEC_Caloctora")),
                                ("1", plain("Voyagers")),
                            ],
                        ),
                    )],
                ),
            ),
        ],
    )
}

fn planet_iii() -> NameTemplate {
    template(
        "PLANET_NAME_FORMAT",
        vec![
            ("PARENT", plain("PRESCRIPTED_system_name_xt489")),
            ("NUMERAL", literal("III")),
        ],
    )
}

#[test]
fn resolves_the_sequential_name_formats_in_english() {
    let loc = &common::cached_fixture().loc;
    let seq = |fmt: &str, num: &str| {
        loc.resolve_template(&template(
            "%SEQ%",
            vec![("fmt", plain(fmt)), ("num", literal(num))],
        ))
    };
    assert_eq!(seq("HUMAN1_FLEET", "1"), "1st Fleet");
    assert_eq!(seq("HUMAN1_FLEET", "12"), "12th Fleet");
    assert_eq!(seq("HUMAN1_FLEET", "23"), "23rd Fleet");
    assert_eq!(seq("MOL3_FLEET", "14"), "XIV Armada");
    assert_eq!(seq("NUM_FORMATS", "11"), "11 b 10th 10");
    assert_eq!(seq("UNIT_FORMAT", "3"), "Unit 3");
}

#[test]
fn fills_a_format_from_its_variables() {
    let loc = &common::cached_fixture().loc;
    assert_eq!(loc.resolve_template(&literal("III")), "III");
    assert_eq!(loc.resolve_template(&planet_iii()), "Xt489 III");

    let moon = template(
        "SUBPLANET_NAME_FORMAT",
        vec![("PARENT", planet_iii()), ("NUMERAL", literal("a"))],
    );
    assert_eq!(loc.resolve_template(&moon), "Xt489 IIIa");

    let star = template(
        "STAR_NAME_1_OF_2",
        vec![("NAME", plain("SPEC_RihiNar_system"))],
    );
    assert_eq!(loc.resolve_template(&star), "Rihi'Nar A");

    let duchy = template(
        "AofB",
        vec![("1", plain("GrandDuchy")), ("2", plain("SPEC_Zelvnak"))],
    );
    assert_eq!(loc.resolve_template(&duchy), "Grand Duchy of Zelvnak");
}

#[test]
fn resolves_the_formats_the_engine_holds_in_code() {
    let loc = &common::cached_fixture().loc;
    let adjective = template(
        "%ADJECTIVE%",
        vec![
            ("adjective", plain("SPEC_Cyggan")),
            ("1", plain("Protectors")),
        ],
    );
    assert_eq!(loc.resolve_template(&adjective), "Cyggan Protectors");

    let prescripted = template(
        "%ADJ%",
        vec![(
            "1",
            template(
                "PRESCRIPTED_species_adjective_tebrid",
                vec![("1", plain("Continuum"))],
            ),
        )],
    );
    assert_eq!(loc.resolve_template(&prescripted), "Homologian Continuum");
}

#[test]
fn appends_the_variables_no_placeholder_consumed_in_order() {
    let loc = &common::cached_fixture().loc;
    let name = template(
        "%ADJ%",
        vec![(
            "1",
            template(
                "United",
                vec![(
                    "1",
                    template(
                        "%ADJECTIVE%",
                        vec![
                            ("adjective", plain("SPEC_RihiNar")),
                            ("1", plain("Sovereignty")),
                        ],
                    ),
                )],
            ),
        )],
    );
    assert_eq!(loc.resolve_template(&name), "United Rihi'Nar Sovereignty");
}

#[test]
fn strips_a_key_with_no_localisation() {
    let loc = &common::cached_fixture().loc;
    assert_eq!(
        loc.resolve_template(&plain("NAME_Gamma_Refuge")),
        "Gamma Refuge"
    );
    let adjective = template("%ADJECTIVE%", vec![("adjective", plain("SPEC_Ti-Zru"))]);
    assert_eq!(loc.resolve_template(&adjective), "Ti-Zru");
}

#[test]
fn renders_an_acronym_from_the_initials_of_its_base_name() {
    let loc = &common::cached_fixture().loc;
    let acronym =
        |base: NameTemplate| loc.resolve_template(&template("%ACRONYM%", vec![("base", base)]));
    let nation = template(
        "AofBpfx",
        vec![("1", plain("SPEC_Athallid_planet")), ("2", plain("Nation"))],
    );
    assert_eq!(acronym(nation), "AJN");
    assert_eq!(acronym(plain("NAME_United_Nations")), "UNE");
    assert_eq!(acronym(plain("PRESCRIPTED_country_name_pious")), "PCV");
    assert_eq!(acronym(literal("")), "");
    assert_eq!(loc.resolve_template(&template("%ACRONYM%", Vec::new())), "");
}

#[test]
fn fills_a_slot_the_entry_already_resolved_to_its_generic_word() {
    let loc = &common::cached_fixture().loc;
    assert_eq!(loc.resolve_template(&lum_lusolis()), "CV Lum Lusolis");
    let mining = template(
        "shipclass_mining_station_name",
        vec![("PLANET", plain("NAME_Sol"))],
    );
    assert_eq!(loc.resolve_template(&mining), "Sol Mining Station");
    let station = template(
        "STARBASE_STATION_NAME_FORMAT_NON_PRIMARY",
        vec![("PLANET", plain("NAME_Sol"))],
    );
    assert_eq!(loc.resolve_template(&station), "Sol Station");
}

#[test]
fn stops_recursing_past_the_depth_cap() {
    let loc = &common::cached_fixture().loc;
    let mut deep = plain("Sovereignty");
    for _ in 0..20 {
        deep = template("%ADJ%", vec![("1", deep)]);
    }
    assert_eq!(loc.resolve_template(&deep), "");
}

/// The game writes `$$` where it means a literal one; the second `$` opens the placeholder.
#[test]
fn a_doubled_dollar_is_not_a_placeholder() {
    let loc = Localisation::default();
    let seq = template(
        "%SEQ%",
        vec![("fmt", plain("$$ $ORD$")), ("num", literal("2"))],
    );
    assert_eq!(loc.resolve_template(&seq), "$2ORD$");
}
