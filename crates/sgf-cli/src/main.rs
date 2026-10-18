use std::process::ExitCode;

use clap::Parser;

use sgf_core::ops::MegastructurePlace;
use sgf_core::prepare::PrepareOptions;
use sgf_core::views::OrbitPlacement;
use sgf_gamedata::LoadOptions;
use sgf_gamedata::generate::{BodyAsk, BuiltSystem, HostMoons};

mod cli;
mod commands;

use cli::{Cli, Command, NebulaCommand};
use commands::Outcome;

fn main() -> ExitCode {
    match run(Cli::parse()) {
        Ok(outcome) => outcome.into(),
        Err(e) => {
            eprintln!("error: {e}");
            ExitCode::FAILURE
        }
    }
}

fn run(cli: Cli) -> commands::Run {
    match cli.command {
        None => {
            println!("sgf {}", sgf_core::VERSION);
            Ok(Outcome::Ok)
        }
        Some(Command::Inspect { sav, galaxy }) => commands::inspect::run(&sav, galaxy),
        Some(Command::Validate { doc }) => commands::validate::run(&doc),
        Some(Command::Details { sav, id }) => commands::details::run(&sav, id),
        Some(Command::ExportScenario {
            sav,
            out,
            name,
            install,
            gamedata,
            profile,
        }) => commands::export::run(
            &sav,
            &out,
            name.as_deref(),
            gamedata.then(|| install.options()).as_ref(),
            profile,
        ),
        Some(Command::NewScenario {
            name,
            out,
            core_radius,
            profile,
        }) => commands::export::create(&name, core_radius, &out, profile),
        Some(Command::Shape { sav, diff, section }) => {
            commands::shape::run(&sav, diff.as_deref(), &section)
        }
        Some(Command::Roundtrip {
            input,
            output,
            check,
        }) => commands::roundtrip::run(&input, &output, check),
        Some(Command::Apply { sav, edits, out }) => {
            commands::apply::run(&sav, out.path.as_deref(), &edits)
        }
        Some(Command::Nebula {
            command:
                NebulaCommand::Add {
                    sav,
                    x,
                    y,
                    radius,
                    name,
                    install,
                    out,
                },
        }) => commands::mutate::add_nebula(
            &sav,
            out.path.as_deref(),
            (x, y, radius),
            name,
            &install.options(),
        ),
        Some(Command::PlanetClass {
            sav,
            planet,
            class,
            install,
            out,
        }) => commands::mutate::planet_class(
            &sav,
            out.path.as_deref(),
            planet,
            &class,
            &install.options(),
        ),
        Some(Command::AddSystem {
            sav,
            then_remove,
            seed,
            at,
            lanes,
            name,
            star_class,
            layout,
            cluster,
            no_extras,
            print_spec,
            then_reroll,
            keep_special,
            arrangement,
            stars,
            filed_as,
            no_planets,
            random_binary,
            random_trinary,
            install,
            out,
        }) => commands::add_system::generated(
            &sav,
            out.path.as_deref(),
            commands::add_system::Generate {
                seed,
                at,
                lanes,
                name,
                star_class,
                layout,
                cluster,
                extras: !no_extras,
                print_spec,
                then_reroll,
                keep_special,
                built: arrangement.map(|layout| BuiltSystem {
                    layout,
                    stars,
                    star_class: filed_as,
                    planets: !no_planets,
                }),
                star_count: match (random_binary, random_trinary) {
                    (true, _) => Some(2),
                    (_, true) => Some(3),
                    _ => None,
                },
            },
            &then_remove,
            &install.options(),
        ),
        Some(Command::AddBody {
            sav,
            system,
            class,
            size,
            moon_of,
            radius,
            angle,
            name,
            seed,
            install,
            out,
        }) => commands::add_body::run(
            &sav,
            out.path.as_deref(),
            BodyAsk {
                system,
                parent: moon_of,
                class,
                size,
                at: OrbitPlacement { radius, angle },
                name,
            },
            seed,
            &install.options(),
        ),
        Some(Command::AddMegastructure {
            sav,
            system,
            kind,
            body,
            at,
            keep_planet,
            keep_moons,
            install,
            out,
        }) => {
            let place = match (body, at) {
                (Some(body), None) => MegastructurePlace::Body { body },
                (Some(body), Some((x, y))) => MegastructurePlace::Beside { body, x, y },
                (None, at) => {
                    let (x, y) = at.unwrap_or_default();
                    MegastructurePlace::Free { x, y }
                }
            };
            commands::add_megastructure::run(
                &sav,
                out.path.as_deref(),
                system,
                &kind,
                place,
                keep_planet,
                if keep_moons {
                    HostMoons::Keep
                } else {
                    HostMoons::Remove
                },
                &install.options(),
            )
        }
        Some(Command::CopyPlanet {
            sav,
            bodies,
            to,
            at,
            from,
            out,
        }) => {
            commands::copy_planet::run(&sav, out.path.as_deref(), from.as_deref(), &bodies, to, at)
        }
        Some(Command::Synth {
            systems,
            seed,
            waystations,
            out,
        }) => commands::synth::run(systems, seed, &waystations, out),
        Some(Command::Gamedata {
            install,
            lang,
            report,
            limit,
        }) => {
            let opts = LoadOptions {
                language: lang,
                ..install.options()
            };
            if report {
                commands::gamedata::report(&opts, limit)
            } else {
                commands::gamedata::run(&opts)
            }
        }
        Some(Command::Special {
            sav,
            install,
            no_gamedata,
        }) => commands::special::run(&sav, &install.options(), !no_gamedata),
        Some(Command::Prepare {
            scenario,
            preset,
            rows,
            seed,
            roll_around_seats,
            install,
            out,
        }) => commands::prepare::run(
            &scenario,
            out.path.as_deref(),
            preset,
            &rows,
            &PrepareOptions {
                clear_around_seats: !roll_around_seats,
                seed,
            },
            &install.options(),
        ),
        Some(Command::SpecialLayouts { sav, install }) => {
            commands::special_layouts::run(&sav, &install.options())
        }
        Some(Command::Texture { key, out, install }) => {
            commands::texture::run(&key, &out, &install.options())
        }
    }
}
