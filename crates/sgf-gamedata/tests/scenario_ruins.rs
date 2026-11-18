//! What a scenario's Add megastructure offers at a spot of a system, and the ruin it writes,
//! on the real install.
use sgf_core::document::Document;
use sgf_core::format::scenario::placed::STAR_BODY;
use sgf_core::ops::{MegastructurePlace, NewMegastructurePlace, Op};
use sgf_core::session::Session;
use sgf_gamedata::generate::{
    AddSpot, HostMoons, MegastructureFit, megastructure_fits, megastructure_op,
};

use crate::common;

/// Kel, a plain system, and Yard, whose initializer spawns a ruined Mega Shipyard on its star.
const RUINS: &str = "static_galaxy_scenario = {
	name = \"ruins\"
	system = { id = \"1\" name = \"Kel\" position = { x = 0 y = 0 } initializer = basic_init_01 }
	system = { id = \"2\" name = \"Yard\" position = { x = 50 y = 0 } initializer = mega_shipyard_init_01 }
}
";

fn session() -> Session {
    let doc = Document::from_scenario_bytes(RUINS.as_bytes().to_vec()).expect("index");
    Session::from_document(None, doc).expect("project")
}

fn fit<'f>(fits: &'f [MegastructureFit], kind: &str) -> &'f MegastructureFit {
    fits.iter()
        .find(|fit| fit.kind == kind)
        .unwrap_or_else(|| panic!("{kind} is not offered"))
}

const STAR: AddSpot = AddSpot::Body { body: STAR_BODY };

/// The star takes a ruined Dyson Sphere, empty space a ruined Gateway at the point pressed and
/// the Dyson Sphere only to say it goes on the star, and a planet nothing.
#[test]
fn a_scenario_offers_star_ruins_on_the_star_and_point_ruins_in_space() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let session = session();
    let on_star = megastructure_fits(gd, &session, 1, STAR).expect("the star");
    let dyson = fit(&on_star, "dyson_sphere_ruined");
    assert_eq!(dyson.place, MegastructurePlace::Body { body: STAR_BODY });
    assert_eq!(dyson.refusal, None);

    let space = AddSpot::Space { x: 120.0, y: 40.0 };
    let in_space = megastructure_fits(gd, &session, 1, space).expect("empty space");
    let gateway = fit(&in_space, "gateway_ruined");
    assert_eq!(
        gateway.place,
        MegastructurePlace::Free { x: 120.0, y: 40.0 }
    );
    assert_eq!(gateway.refusal, None);
    let shell = fit(&in_space, "dyson_sphere_ruined");
    assert_eq!(
        shell.refusal.as_deref(),
        Some("Ruined Dyson Sphere goes on the star. Right-click the star to add it.")
    );

    let planet = AddSpot::Body {
        body: STAR_BODY + 1,
    };
    assert_eq!(
        megastructure_fits(gd, &session, 1, planet).expect("a planet"),
        []
    );
    assert!(
        megastructure_fits(gd, &session, 99, STAR).is_err(),
        "no system 99"
    );
}

/// A star whose initializer spawns a ruin on it is refused every ruin, though the scenario's
/// block holds none.
#[test]
fn a_star_the_initializer_gives_a_ruin_takes_no_other() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let fits = megastructure_fits(gd, &session(), 2, STAR).expect("the star");
    assert!(!fits.is_empty());
    assert!(
        fits.iter()
            .all(|fit| fit.refusal.as_deref() == Some("It already has a megastructure.")),
        "{fits:?}"
    );
}

/// The op writes a ruin where it goes, with nothing but its type and place, and refuses one
/// asked for elsewhere.
#[test]
fn the_ruin_op_writes_a_ruin_only_where_it_goes() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let session = session();
    let add =
        |kind: &str, place| megastructure_op(gd, &session, 1, kind, place, false, HostMoons::Keep);
    let star = MegastructurePlace::Body { body: STAR_BODY };
    let planned = add("dyson_sphere_ruined", star).expect("the Dyson Sphere");
    let Op::AddMegastructure { system, spec } = planned.op else {
        panic!("{:?}", planned.op);
    };
    assert_eq!(system, 1);
    assert_eq!(spec.kind, "dyson_sphere_ruined");
    assert_eq!(spec.at, NewMegastructurePlace::from(star));
    assert_eq!(
        (spec.owner, spec.bypass, spec.construction),
        (None, None, None)
    );
    assert!(planned.unsure.is_empty() && planned.unwritten.is_empty());

    let free = MegastructurePlace::Free { x: 50.0, y: 0.0 };
    let away = add("dyson_sphere_ruined", free).expect_err("away from the star");
    assert!(away.to_string().contains("goes on the star"), "{away}");
    let planet = MegastructurePlace::Body {
        body: STAR_BODY + 1,
    };
    assert!(add("gateway_ruined", planet).is_err(), "on a planet");
    assert!(add("hyper_relay", free).is_err(), "not a scenario's ruin");
}
