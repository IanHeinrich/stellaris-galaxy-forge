/** The fleets present: how they group by owner, the power they read as, and their owners' flags. */
import type { CountryNode } from "../../generated/CountryNode";
import type { FleetSummary } from "../../generated/FleetSummary";
import type { SystemDetails } from "../../generated/SystemDetails";
import { type CountryTypes, isFauna } from "../countryKinds";
import { flagKey } from "../flagKey";

export interface FleetGroup {
  owner: number | null;
  name: string;
  power: number;
  fleets: FleetSummary[];
}

/** Every ship in the fleet is knocked out. */
export function fleetDisabled(f: FleetSummary): boolean {
  return f.military_power === 0 && f.ships > 0 && f.disabled_ships >= f.ships;
}

/** A fleet's power as the game shows it: a skull for a planet killer, "disabled" when every ship is out. */
export function fleetPower(f: FleetSummary): string {
  if (f.planet_killer) return "☠";
  if (fleetDisabled(f)) return "disabled";
  return formatPower(f.military_power);
}

/** The power clause of a military row: the skull and "disabled" states stand on their own. */
export function fleetPowerClause(f: FleetSummary): string {
  return f.planet_killer || fleetDisabled(f) ? fleetPower(f) : `power ${fleetPower(f)}`;
}

/** `8,019` below a million, `1.01m` from there. */
export function formatPower(n: number): string {
  if (n < 1_000_000) return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${(n / 1_000_000).toFixed(2)}m`;
}

export function fleetLabel(count: number): string {
  return `${count} fleet${count === 1 ? "" : "s"}`;
}

export function militaryFleets(d: SystemDetails): FleetSummary[] {
  return d.fleets_present.filter((f) => f.military);
}

/**
 * The military fleets present grouped by owner in order of first appearance, ownerless ones
 * last as the neutral group, each with its summed power.
 */
export function fleetGroups(d: SystemDetails, countryName: (id: number) => string): FleetGroup[] {
  const groups = new Map<number | null, FleetGroup>();
  for (const f of militaryFleets(d)) {
    let g = groups.get(f.owner);
    if (!g) {
      g = {
        owner: f.owner,
        name: f.owner === null ? "Neutral fleets" : countryName(f.owner),
        power: 0,
        fleets: [],
      };
      groups.set(f.owner, g);
    }
    g.power += f.military_power;
    g.fleets.push(f);
  }
  return [...groups.values()].sort((a, b) => Number(a.owner === null) - Number(b.owner === null));
}

/** The empire and fauna sides of the fleets present, each empty when nobody of that kind is here. */
export function fleetSides(
  groups: readonly FleetGroup[],
  countries: ReadonlyMap<number, CountryNode>,
  types: CountryTypes,
): { empire: FleetGroup[]; fauna: FleetGroup[] } {
  const empire: FleetGroup[] = [];
  const fauna: FleetGroup[] = [];
  for (const g of groups) {
    const country = g.owner === null ? undefined : countries.get(g.owner);
    (isFauna(country, types) ? fauna : empire).push(g);
  }
  return { empire, fauna };
}

export function empireFlagKey(country: CountryNode | undefined): string | null {
  const icon = country?.flag_icon;
  const background = country?.flag_background;
  if (!icon || !background) return null;
  return flagKey(background, icon, country.colors);
}
