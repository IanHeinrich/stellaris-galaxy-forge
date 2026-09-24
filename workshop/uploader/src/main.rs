mod changelog;
mod commands;
mod local;
mod plan;
mod state;
mod steam;

use std::process::ExitCode;

use commands::PushMode;
use local::Repo;

const DEFAULT_ITEM: u64 = 3805578137;

const USAGE: &str = "\
Updates the Galaxy Forge page on the Steam Workshop from the files in workshop/.
Steam must be open and logged in as the item's owner.

usage: cargo workshop <command> [options]   (from the repo root)

commands:
  pull [--force]              write the live description and images into workshop/
                              (--force replaces local files that differ)
  init [--force]              record the local images and VERSION as uploaded
                              (--force replaces the item's existing metadata)
  push [--dry-run] [--yes] [--force]
                              show what changed since the last push, ask, then upload
                              (--dry-run only shows; --yes skips the question;
                              --force uploads everything)

options:
  --item <id>                 the workshop item (default 3805578137)";

enum Command {
    Pull,
    Init,
    Push,
}

struct Args {
    command: Command,
    item: u64,
    force: bool,
    push_mode: PushMode,
}

fn main() -> ExitCode {
    let raw: Vec<String> = std::env::args().skip(1).collect();
    if raw.is_empty() || raw.iter().any(|arg| arg == "--help" || arg == "-h") {
        println!("{USAGE}");
        return ExitCode::SUCCESS;
    }
    match parse(&raw).and_then(|args| run(&args)) {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("error: {message}");
            ExitCode::FAILURE
        }
    }
}

fn run(args: &Args) -> Result<(), String> {
    let repo = Repo::find()?;
    match args.command {
        Command::Pull => commands::pull(&repo, args.item, args.force),
        Command::Init => commands::init(&repo, args.item, args.force),
        Command::Push => commands::push(&repo, args.item, args.push_mode, args.force),
    }
}

fn parse(raw: &[String]) -> Result<Args, String> {
    let command = match raw[0].as_str() {
        "pull" => Command::Pull,
        "init" => Command::Init,
        "push" => Command::Push,
        other => return Err(format!("unknown command {other:?}; see --help")),
    };
    let mut args = Args {
        command,
        item: DEFAULT_ITEM,
        force: false,
        push_mode: PushMode::Ask,
    };
    let mut rest = raw[1..].iter();
    while let Some(arg) = rest.next() {
        match arg.as_str() {
            "--force" => args.force = true,
            "--dry-run" if matches!(args.command, Command::Push) => {
                args.push_mode = PushMode::DryRun
            }
            "--yes" if matches!(args.command, Command::Push) => args.push_mode = PushMode::Yes,
            "--item" => {
                let id = rest.next().ok_or("--item needs a workshop item id")?;
                args.item = id
                    .parse()
                    .map_err(|_| format!("--item {id:?} is not a workshop item id"))?;
            }
            other => {
                return Err(format!(
                    "unknown option {other:?} for {}; see --help",
                    raw[0]
                ));
            }
        }
    }
    Ok(args)
}
