use std::process::ExitCode;

use clap::Parser;
use sgf_core::ops::Op;
use sgf_gamedata::LoadOptions;

mod cli;
mod commands;

use cli::{Cli, Command, HeaderCommand, LaneCommand, NebulaCommand, SpawnCommand};
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
        Some(Command::Details { sav, id, all: _ }) => commands::details::run(&sav, id),
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
        Some(Command::Move { sav, id, x, y, out }) => {
            commands::mutate::run(&sav, out.path.as_deref(), Op::MoveSystem { id, x, y })
        }
        Some(Command::MoveNebula {
            sav,
            index,
            x,
            y,
            out,
        }) => commands::mutate::run(&sav, out.path.as_deref(), Op::MoveNebula { index, x, y }),
        Some(Command::Nebula { command }) => match command {
            NebulaCommand::Add {
                sav,
                x,
                y,
                radius,
                name,
                out,
            } => commands::mutate::run(
                &sav,
                out.path.as_deref(),
                Op::AddNebula { x, y, radius, name },
            ),
            NebulaCommand::Remove { sav, index, out } => {
                commands::mutate::run(&sav, out.path.as_deref(), Op::RemoveNebula { index })
            }
            NebulaCommand::Radius {
                sav,
                index,
                radius,
                out,
            } => commands::mutate::run(
                &sav,
                out.path.as_deref(),
                Op::SetNebulaRadius { index, radius },
            ),
            NebulaCommand::Name {
                sav,
                index,
                name,
                out,
            } => {
                commands::mutate::run(&sav, out.path.as_deref(), Op::SetNebulaName { index, name })
            }
        },
        Some(Command::Header { command }) => match command {
            HeaderCommand::Set {
                sav,
                key,
                value,
                out,
            } => commands::mutate::run(
                &sav,
                out.path.as_deref(),
                Op::SetHeaderField {
                    key,
                    value: Some(value),
                },
            ),
            HeaderCommand::Unset { sav, key, out } => commands::mutate::run(
                &sav,
                out.path.as_deref(),
                Op::SetHeaderField { key, value: None },
            ),
        },
        Some(Command::Lane { command }) => match command {
            LaneCommand::Add {
                sav,
                a,
                b,
                bridge,
                out,
            } => commands::mutate::run(&sav, out.path.as_deref(), Op::AddLane { a, b, bridge }),
            LaneCommand::Remove { sav, a, b, out } => {
                commands::mutate::run(&sav, out.path.as_deref(), Op::RemoveLane { a, b })
            }
            LaneCommand::Prevent { sav, a, b, out } => {
                commands::mutate::run(&sav, out.path.as_deref(), Op::PreventLane { a, b })
            }
            LaneCommand::Allow { sav, a, b, out } => {
                commands::mutate::run(&sav, out.path.as_deref(), Op::UnpreventLane { a, b })
            }
            LaneCommand::Normalise { sav, a, b, out } => {
                commands::mutate::run(&sav, out.path.as_deref(), Op::NormaliseLaneLength { a, b })
            }
            LaneCommand::Length {
                sav,
                a,
                b,
                length,
                out,
            } => commands::mutate::run(
                &sav,
                out.path.as_deref(),
                Op::SetLaneLength { a, b, length },
            ),
        },
        Some(Command::Spawn { command }) => match command {
            SpawnCommand::Weight { sav, id, base, out } => commands::mutate::run(
                &sav,
                out.path.as_deref(),
                Op::SetSpawnWeight {
                    id,
                    base: commands::mutate::spawn_base(&base)?,
                },
            ),
        },
        Some(Command::Isolate { sav, id, out }) => {
            commands::mutate::run(&sav, out.path.as_deref(), Op::IsolateSystem { id })
        }
        Some(Command::Star {
            sav,
            id,
            class,
            bodies,
            out,
        }) => commands::mutate::run(
            &sav,
            out.path.as_deref(),
            Op::SetStarClass { id, class, bodies },
        ),
        Some(Command::PlanetSize {
            sav,
            planet,
            size,
            out,
        }) => commands::mutate::run(
            &sav,
            out.path.as_deref(),
            Op::SetPlanetSize { id: planet, size },
        ),
        Some(Command::AddSystem { sav, spec, out }) => commands::mutate::run(
            &sav,
            out.path.as_deref(),
            Op::AddSaveSystem {
                spec: commands::mutate::system_spec(&spec)?,
            },
        ),
        Some(Command::Synth {
            systems,
            seed,
            waystations,
            out,
        }) => commands::synth::run(systems, seed, &waystations, out),
        Some(Command::Gamedata {
            install,
            lang,
            no_mods,
        }) => commands::gamedata::run(&LoadOptions {
            language: lang,
            mods: !no_mods,
            ..install.options()
        }),
        Some(Command::Special {
            sav,
            install,
            no_gamedata,
        }) => commands::special::run(&sav, &install.options(), !no_gamedata),
        Some(Command::Texture { key, out, install }) => {
            commands::texture::run(&key, &out, &install.options())
        }
    }
}
