//! The projection of the Stellaris 4.5 (Cygnus) sample save.
use sgf_core::projections::galaxy::GalaxyGraph;

use crate::common;

#[test]
fn projection_reads_the_map_colours_only_where_the_empire_chose_them() {
    let doc = common::load_4_5();
    let g = GalaxyGraph::build(&doc).expect("build galaxy");
    assert_eq!(g.systems.len(), 601);
    assert_eq!(g.order, (0..=600).collect::<Vec<u32>>());

    let player = g.countries.iter().find(|c| c.id == 0).expect("country 0");
    assert_eq!(player.name_key, "Test Empire");
    assert_eq!(player.border_color.as_deref(), Some("intense_red"));
    assert_eq!(player.fill_color.as_deref(), Some("light_pink"));
    assert_eq!(player.colors[..4], ["grey", "dark_blue", "black", "grey"]);

    let ai = g.countries.iter().find(|c| c.id == 1).expect("country 1");
    assert_eq!(ai.border_color, None);
    assert_eq!(ai.fill_color, None);
    assert_eq!(ai.colors[..2], ["red", "purple"]);
    let chosen = g
        .countries
        .iter()
        .filter(|c| c.border_color.is_some() || c.fill_color.is_some())
        .count();
    assert_eq!(
        chosen, 1,
        "only the player empire set independent map colours"
    );

    let painted = |c: &sgf_core::projections::galaxy::CountryNode| {
        (c.painted_border.clone(), c.painted_fill.clone())
    };
    let pair = |border: &str, fill: &str| (Some(border.to_owned()), Some(fill.to_owned()));
    assert_eq!(painted(player), pair("intense_red", "light_pink"));
    assert_eq!(painted(ai), pair("red", "purple"));
    assert_eq!(player.has_map_colors, Some(true));
    assert_eq!(ai.has_map_colors, Some(true));
}

/// The pair the map paints each country in: its chosen map colours, and the named flag
/// colours wherever it chose none, each of the two standing in for the other.
#[test]
fn every_country_is_painted_in_its_map_colours_or_its_flag_colours() {
    let expected = |c: &sgf_core::projections::galaxy::CountryNode| {
        let (first, second) = (c.colors.first(), c.colors.get(1));
        (
            c.border_color.as_ref().or(first).or(second).cloned(),
            c.fill_color.as_ref().or(second).or(first).cloned(),
        )
    };
    let g = GalaxyGraph::build(&common::load_4_5()).expect("build galaxy");
    for country in &g.countries {
        assert_eq!(
            (country.painted_border.clone(), country.painted_fill.clone()),
            expected(country),
            "country {}",
            country.id
        );
    }

    let border = "\t\t\t\t\"intense_red\"\n\t\t\t\t\"light_pink\"\n";
    let edited = common::open_edited_sample(common::SAMPLE_4_5, |text, _| {
        assert_eq!(text.matches(border).count(), 1, "the player's map pair");
        *text = text.replacen(border, "\t\t\t\t\"null\"\n\t\t\t\t\"light_pink\"\n", 1);
    });
    let g = edited.graph;
    let player = g.countries.iter().find(|c| c.id == 0).expect("country 0");
    assert_eq!(player.painted_border.as_deref(), Some("grey"));
    assert_eq!(player.painted_fill.as_deref(), Some("light_pink"));
}
