import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SystemNode } from "../generated/SystemNode";
import { lanesTo, name, systemNode } from "./builders";

const SYSTEM =
  /system = \{ id = "(\d+)" name = "([^"]*)" position = \{ x = (-?[\d.]+) y = (-?[\d.]+) \}(?: initializer = (\w+))?/g;
const LANE = /add_hyperlane = \{ from = "(\d+)" to = "(\d+)" \}/g;

/**
 * The 4.4 sample save's galaxy, read from its scenario export in `testdata/`: every system with
 * its name, position, initializer and lanes, as a real galaxy lays them out.
 */
export function sampleGalaxy(): SystemNode[] {
  const text = readFileSync(
    join(import.meta.dirname, "../../../testdata/4.4-early.scenario.txt"),
    "utf8",
  );
  const links = new Map<number, number[]>();
  const link = (a: number, b: number) => links.set(a, [...(links.get(a) ?? []), b]);
  for (const [, from, to] of text.matchAll(LANE)) {
    link(Number(from), Number(to));
    link(Number(to), Number(from));
  }
  return [...text.matchAll(SYSTEM)].map(([, id, key, x, y, initializer]) =>
    systemNode({
      id: Number(id),
      name: name(key),
      x: Number(x),
      y: Number(y),
      initializer: initializer ?? "",
      lanes: lanesTo(...(links.get(Number(id)) ?? [])),
    }),
  );
}
