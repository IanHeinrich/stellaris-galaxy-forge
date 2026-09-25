use std::process::ExitCode;

use clap::Parser;
use sgf_core::ops::Op;
use sgf_gamedata::LoadOptions;

mod cli;
mod commands;

use cli::{Cli, Command, DepositCommand, HeaderCommand, LaneCommand, NebulaCommand, SpawnCommand};
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
                install,
                out,
            } => commands::mutate::add_nebula(
                &sav,
                out.path.as_deref(),
                (x, y, radius),
                name,
                &install.options(),
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
            NebulaCommand::Turbulent {
                sav,
                index,
                calm,
                out,
            } => commands::mutate::run(
                &sav,
                out.path.as_deref(),
                Op::SetNebulaTurbulent {
                    nebula: index,
                    turbulent: !calm,
                },
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
        Some(Command::Deposit { command }) => match command {
            DepositCommand::Add {
                sav,
                planets,
                kinds,
                out,
            } => {
                if planets.len() != kinds.len() {
                    return Err("each --planet takes one --type".into());
                }
                let ops = planets
                    .into_iter()
                    .zip(kinds)
                    .map(|(planet, kind)| Op::AddSaveDeposit { planet, kind })
                    .collect();
                commands::mutate::run_all(&sav, out.path.as_deref(), ops)
            }
            DepositCommand::Remove { sav, deposits, out } => {
                let ops = deposits
                    .into_iter()
                    .map(|deposit| Op::RemoveSaveDeposit { deposit })
                    .collect();
                commands::mutate::run_all(&sav, out.path.as_deref(), ops)
            }
        },
        Some(Command::AddSystem {
            sav,
            spec,
            then_remove,
            generate,
            seed,
            at,
            lanes,
            name,
            star_class,
            layout,
            print_spec,
            then_reroll,
            keep_special,
            install,
            out,
        }) => match generate {
            false => {
                commands::add_system::from_specs(&sav, out.path.as_deref(), &spec, &then_remove)
            }
            true => commands::add_system::generated(
                &sav,
                out.path.as_deref(),
                commands::add_system::Generate {
                    seed: seed.expect("clap requires --seed with --generate"),
                    at: at.expect("clap requires --at with --generate"),
                    lanes,
                    name,
                    star_class,
                    layout,
                    print_spec,
                    then_reroll,
                    keep_special,
                },
                &then_remove,
                &install.options(),
            ),
        },
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
        Some(Command::SpecialLayouts { sav, install }) => {
            commands::special_layouts::run(&sav, &install.options())
        }
        Some(Command::Texture { key, out, install }) => {
            commands::texture::run(&key, &out, &install.options())
        }
    }
}
