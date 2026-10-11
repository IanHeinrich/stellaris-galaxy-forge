/** What a scenario system's initializer and one of its bodies say, for the tests that show them. */
import type { BodySpawn } from "../generated/BodySpawn";
import type { SystemSpawn } from "../generated/SystemSpawn";

/** A planet a fixed block places once, of class `pc_barren`, stating nothing else. */
export function bodySpawn(over: Partial<BodySpawn> = {}): BodySpawn {
  return {
    always: true,
    copy: 1,
    count: { min: 1, max: 1 },
    class: { state: "fixed", class: "pc_barren" },
    changed_class: null,
    changed_size: null,
    deposits: [],
    no_blockers: false,
    features: { modifier: null, none: false, cleared: false, added: [] },
    anomalies: { categories: [], prevented: null },
    entity: null,
    name: null,
    flags: [],
    starting_planet: false,
    home_planet: false,
    other_keys: [],
    script: [],
    from_script: null,
    variables: [],
    ...over,
  };
}

/** A system of a fixed G star and one planet, stating nothing a random galaxy reads. */
export function systemSpawn(over: Partial<SystemSpawn> = {}): SystemSpawn {
  return {
    star: { state: "fixed", class: "sc_g" },
    planets: { min: 1, max: 1 },
    moons: { min: 0, max: 0 },
    asteroids: { min: 0, max: 0 },
    from_script: null,
    flags: [],
    namelist: null,
    prevent_anomalies: false,
    primitive_system: false,
    inner_radius_offset: null,
    outer_radius_offset: null,
    sites: [],
    ambient_objects: [],
    usage: null,
    usage_odds: null,
    spawn_chance: null,
    scaled_spawn_chance: null,
    max_instances: null,
    neighbors: [],
    other_keys: [],
    script: [],
    inline_scripts: [],
    variables: [],
    ...over,
  };
}
