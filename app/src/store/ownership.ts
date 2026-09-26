import { useSyncExternalStore } from "react";
import { templateName } from "../lib/names";
import {
  composeOwnership,
  NO_OWNERSHIP,
  settledOwnership,
  type Ownership,
  type OwnershipInput,
} from "../lib/ownership";
import { useFileSessionStore } from "./fileSessionStore";
import { useGalaxyStore } from "./galaxyStore";
import { useGameDataStore } from "./gameDataStore";

let composedFrom: OwnershipInput | null = null;
let composedNames: unknown = null;
let composed: Ownership = NO_OWNERSHIP;

function inputNow(): OwnershipInput {
  const galaxy = useGalaxyStore.getState();
  const data = useGameDataStore.getState();
  return {
    kind: useFileSessionStore.getState().kind,
    systems: galaxy.systems,
    countries: galaxy.countries,
    countryTypes: data.countryTypes,
    mapColors: data.mapColors,
    countryName: templateName,
  };
}

function sameInput(a: OwnershipInput, b: OwnershipInput): boolean {
  return (
    a.kind === b.kind &&
    a.systems === b.systems &&
    a.countries === b.countries &&
    a.countryTypes === b.countryTypes &&
    a.mapColors === b.mapColors
  );
}

/**
 * Who owns what, as the stores stand: composed once per change to what it reads, and kept
 * by identity while an edit leaves it as it was. The labels follow the localisation.
 */
export function currentOwnership(): Ownership {
  const input = inputNow();
  const names = useGameDataStore.getState().names;
  if (composedFrom === null || !sameInput(composedFrom, input) || names !== composedNames) {
    composedFrom = input;
    composedNames = names;
    composed = settledOwnership(composed, composeOwnership(input));
  }
  return composed;
}

/** Calls `listener` whenever anything `currentOwnership` is composed from changes. */
export function subscribeOwnership(listener: () => void): () => void {
  const offs = [
    useFileSessionStore.subscribe((s, prev) => {
      if (s.kind !== prev.kind) listener();
    }),
    useGalaxyStore.subscribe((s, prev) => {
      if (s.systems !== prev.systems || s.countries !== prev.countries) listener();
    }),
    useGameDataStore.subscribe((s, prev) => {
      const { countryTypes, mapColors, names } = prev;
      if (s.countryTypes !== countryTypes || s.mapColors !== mapColors || s.names !== names) {
        listener();
      }
    }),
  ];
  return () => {
    for (const off of offs) off();
  };
}

/** The same, re-rendered when anything it is composed from changes. */
export function useOwnership(): Ownership {
  return useSyncExternalStore(subscribeOwnership, currentOwnership, currentOwnership);
}
