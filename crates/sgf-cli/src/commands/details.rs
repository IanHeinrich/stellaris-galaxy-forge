//! `sgf details`: one system's planets, deposits, starbase and fleets, or a line per
//! system that has anything to show.

use std::path::Path;

use sgf_core::format::save::details::SystemDetails;
use sgf_core::session::Session;

use super::{Outcome, Run, join};

pub fn run(sav: &Path, id: Option<u32>) -> Run {
    let session = Session::open(sav)?;
    let projection = session.details()?;
    let resolver = sgf_gamedata::resolver(None);
    let resolve = |id: u32| projection.resolve(id, resolver, false);
    let name = |id: u32| {
        session
            .system(id)
            .map(|s| s.display_name())
            .unwrap_or_default()
    };
    let Some(id) = id else {
        for &id in &session.graph.order {
            let Some(d) = resolve(id) else {
                continue;
            };
            if d.resources.is_empty()
                && d.starbase.is_none()
                && d.fleets.fleet_count == 0
                && d.megastructures.is_empty()
                && d.sites.is_empty()
                && !d.planets.iter().any(|p| p.colonised)
            {
                continue;
            }
            println!("#{id} {}: {}", name(id), summary(&d));
        }
        return Ok(Outcome::Ok);
    };
    let Some(d) = resolve(id) else {
        println!("no system {id}");
        return Ok(Outcome::Failed);
    };
    println!("{} (#{id})", name(id));
    println!("resources: {}", resources(&d));
    let colonised = d.planets.iter().filter(|p| p.colonised).count();
    let capital = d
        .planets
        .iter()
        .find(|p| p.capital)
        .map(|p| format!(", capital: {}", p.name_key))
        .unwrap_or_default();
    println!(
        "planets: {} (colonised {colonised}{capital})",
        d.planets.len()
    );
    let mut listed = 0;
    for p in d.planets.iter().filter(|p| p.colonised || p.capital) {
        listed += 1;
        let owner = p.owner.map(|o| format!(" owner {o}")).unwrap_or_default();
        println!(
            "  {} {} {}{}{}{}{}{owner}",
            p.id,
            p.name_key,
            p.class,
            if p.moon { " moon" } else { "" },
            if p.colonised { " colonised" } else { "" },
            if p.capital { " capital" } else { "" },
            if p.pre_ftl { " pre-ftl" } else { "" }
        );
    }
    if d.planets.len() > listed {
        println!("  +{} more", d.planets.len() - listed);
    }
    match &d.starbase {
        Some(s) => println!("starbase: {} owner {}", s.level, owner_text(s.owner)),
        None => println!("starbase: none"),
    }
    println!(
        "fleets: {} military, {} ships, power {} ({} present)",
        d.fleets.military_count, d.fleets.ship_count, d.fleets.military_power, d.fleets.fleet_count
    );
    for f in &d.fleets_present {
        println!(
            "  {} {} owner {}{} power {} ships {}",
            f.id,
            f.name_key,
            owner_text(f.owner),
            if f.military { " military" } else { "" },
            f.military_power,
            f.ships
        );
    }
    println!(
        "megastructures: {}",
        if d.megastructures.is_empty() {
            "none".to_owned()
        } else {
            join(
                d.megastructures
                    .iter()
                    .map(|m| format!("{} {} owner {}", m.id, m.kind, owner_text(m.owner))),
            )
        }
    );
    println!(
        "sites: {}",
        if d.sites.is_empty() {
            "none".to_owned()
        } else {
            join(
                d.sites
                    .iter()
                    .map(|s| format!("{} {} on planet {}", s.id, s.kind, s.planet)),
            )
        }
    );
    Ok(Outcome::Ok)
}

fn summary(d: &SystemDetails) -> String {
    let mut parts = Vec::new();
    if !d.resources.is_empty() {
        parts.push(resources(d));
    }
    let colonised = d.planets.iter().filter(|p| p.colonised).count();
    if colonised > 0 {
        parts.push(format!(
            "{colonised} colonised of {} planets",
            d.planets.len()
        ));
    }
    if let Some(s) = &d.starbase {
        parts.push(format!("{} owner {}", s.level, owner_text(s.owner)));
    }
    if d.fleets.fleet_count > 0 {
        parts.push(format!(
            "{} present ({} military, {} ships, power {})",
            d.fleets.fleet_count,
            d.fleets.military_count,
            d.fleets.ship_count,
            d.fleets.military_power
        ));
    }
    if !d.megastructures.is_empty() {
        parts.push(join(d.megastructures.iter().map(|m| m.kind.as_str())));
    }
    if !d.sites.is_empty() {
        parts.push(join(d.sites.iter().map(|s| s.kind.as_str())));
    }
    parts.join("; ")
}

fn resources(d: &SystemDetails) -> String {
    if d.resources.is_empty() {
        return "none".to_owned();
    }
    join(d.resources.iter().map(|r| {
        let amount = if r.amount.fract() == 0.0 {
            format!("{:.0}", r.amount)
        } else {
            r.amount.to_string()
        };
        format!("{} {amount}", r.resource)
    }))
}

fn owner_text(owner: Option<u32>) -> String {
    owner.map_or_else(|| "none".to_owned(), |o| o.to_string())
}
