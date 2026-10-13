/**
 * The Add megastructure dialog's tests: a save system owned by empire 3, the game data's types,
 * and the fits the shell answers for a spot. Each test file mocks the IPC, the events, the texture
 * cache and zustand before importing this.
 */
import { renderToStaticMarkup } from "react-dom/server";
import type { MegastructureFit } from "../../generated/MegastructureFit";
import type { MegastructureSpot } from "../../lib/megastructurePicks";
import { OPEN_RESULT } from "../../store/fixture";
import { useGalaxyStore } from "../../store/galaxyStore";
import { useGameDataStore } from "../../store/gameDataStore";
import { useMegastructureAddStore } from "../../store/megastructureAdd";
import { armSession, resetStores } from "../../store/storeFixture";
import {
  megastructureFits,
  megastructureSwap,
  megastructureTypeView,
  starbaseSummary,
  systemDetails,
} from "../../test/builders";
import { inSystem, openWith } from "../../test/session";
import { AddMegastructureDialog } from "./AddMegastructureDialog";

export const SYSTEM = 0;
export const OWNER = 3;
export const star: MegastructureSpot = { kind: "body", body: 1, star: true };
export const space: MegastructureSpot = { kind: "space", x: 10, y: 10 };
export const LOOM = ["loom_0", "loom_1", "loom_2", "loom_3", "loom_4", "loom_5"];

/** The types the shell offers in space; it offers every other one on a body. */
const IN_SPACE = new Set(["hyper_relay", "mod_beacon"]);
/** The types it offers on a star and not on a planet. */
const STAR_ONLY = new Set(["dyson_sphere_0", "dyson_sphere_5", "dyson_b_star", ...LOOM]);

/** What a test changes of the shell's fits, by type. */
export type FitsOver = Readonly<Record<string, Partial<MegastructureFit>>>;

/**
 * The dialog as it renders once the shell has answered for its spot: every type of the game data
 * offered there as itself, with no refusal, unless `over` says.
 */
export function dialog(over: FitsOver = {}): string {
  const { prompt } = useMegastructureAddStore.getState();
  if (prompt !== null) {
    const { spot } = prompt;
    const keys = [...useGameDataStore.getState().megastructureTypes.keys()].filter((key) =>
      spot.kind === "space"
        ? IN_SPACE.has(key)
        : !IN_SPACE.has(key) && (spot.star || !STAR_ONLY.has(key)),
    );
    useMegastructureAddStore.setState({ fits: megastructureFits(keys, over) });
  }
  return renderToStaticMarkup(<AddMegastructureDialog />);
}

export function ownSystem(owner: number | null) {
  const systems = new Map(useGalaxyStore.getState().systems);
  systems.set(SYSTEM, { ...systems.get(SYSTEM)!, owner });
  useGalaxyStore.setState({ systems });
}

export function openAt(spot: MegastructureSpot) {
  useMegastructureAddStore.setState({ prompt: { system: SYSTEM, spot } });
}

/**
 * Opens the dialog on the star of a system empire 3 owns, with the Dyson Sphere, a mod's six-stage
 * Loom, a Science Nexus site with no model, the Hyper Relay and a mod's Beacon.
 */
export async function setUpDialog(): Promise<void> {
  resetStores();
  armSession();
  await openWith(OPEN_RESULT);
  inSystem(
    systemDetails({
      id: SYSTEM,
      starbase: starbaseSummary({ owner: OWNER, culture: "mammalian_01" }),
    }),
  );
  const onStar = { place: "body", star_only: true } as const;
  const outside = { place: "free", outside_gravity_well: true } as const;
  const types = [
    megastructureTypeView("dyson_sphere_0", { placement: onStar }),
    megastructureTypeView("dyson_sphere_5", {
      upgrade_from: ["dyson_sphere_0"],
      placement: onStar,
      produces: [["energy", 1000]],
      country_effects: [{ key: "country_resource_max_add", value: 5, text: "+5 Max Energy" }],
      construction_summary: [
        {
          on: "system",
          kind: "modifier",
          key: "dyson_glow",
          name: "Dyson Glow",
          permanent: true,
          conditional: false,
        },
      ],
      swaps: [megastructureSwap("dyson_b_star", { classes: ["pc_b_star"] })],
    }),
    megastructureTypeView("dyson_b_star", { placement: onStar }),
    ...LOOM.map((key, i) =>
      megastructureTypeView(key, {
        upgrade_from: i === 0 ? [] : [LOOM[i - 1]],
        placement: onStar,
        source: "Zeta Structures",
        base_game: false,
      }),
    ),
    megastructureTypeView("think_tank_0", { entity: null }),
    megastructureTypeView("hyper_relay", { placement: outside, bypass_type: "relay_bypass" }),
    megastructureTypeView("mod_beacon", {
      placement: outside,
      source: "Zeta Structures",
      base_game: false,
    }),
  ];
  useGameDataStore.setState({
    status: "ready",
    megastructureTypes: new Map(types.map((t) => [t.key, t])),
    names: new Map([
      ["dyson_sphere_0", "Dyson Sphere Site"],
      ["dyson_sphere_5", "Dyson Sphere"],
      ["think_tank_0", "Science Nexus Site"],
      ["hyper_relay", "Hyper Relay"],
      ["mod_beacon", "Beacon"],
      ["dyson_b_star", "B-class Dyson Sphere"],
      ["loom_0", "Loom Site"],
      ["loom_1", "Loom Frame"],
      ["loom_2", "Loom Weave"],
      ["loom_3", "Loom Hum"],
      ["loom_4", "Loom Glow"],
      ["loom_5", "Loom"],
    ]),
    texts: new Map([
      ["dyson_sphere_5_DESC", "A fully operational Dyson Sphere - §G100%§! energy generation."],
      ["dyson_b_star_DESC", "A Dyson Sphere around a blue star."],
    ]),
  });
  useMegastructureAddStore.setState({ last: null });
  openAt(star);
}
