/** The nodes and render context a galaxy map test draws from, without PixiJS. */
import type { GalaxyView } from "../../generated/GalaxyView";
import type { SystemNode } from "../../generated/SystemNode";
import { kindCapabilities } from "../../lib/documentKinds";
import { composeOwnership } from "../../lib/ownership";
import { SpatialGrid } from "../../lib/spatialGrid";
import { systemNode } from "../../test/builders";
import { EMPTY_CONTEXT, type RenderContext } from "../RenderContext";

/** One instance for every context a test builds, so a layer sees a single galaxy throughout. */
const GALAXY = {} as GalaxyView;

/** A system on a row of the x axis, named by a literal the label layer draws as it stands. */
export function mapNode(id: number, x: number, label: string, initializer = ""): SystemNode {
  return systemNode({
    id,
    name: { key: label, literal: true, variables: [] },
    x,
    initializer,
  });
}

/**
 * A context over `nodes`, as the controller would assemble one for a scenario document, its
 * ownership composed from the nodes and the countries unless `over` states it.
 */
export function mapContext(
  nodes: readonly SystemNode[],
  over: Partial<RenderContext> = {},
): RenderContext {
  const systems = new Map(nodes.map((n) => [n.id, n]));
  const grid = new SpatialGrid();
  grid.build(systems.values());
  const ctx = {
    ...EMPTY_CONTEXT,
    galaxy: GALAXY,
    kind: "scenario" as const,
    systems,
    grid,
    ...over,
  };
  ctx.capabilities = over.capabilities ?? kindCapabilities(ctx.kind);
  if (over.owners !== undefined || over.table !== undefined) return ctx;
  const { owners, table } = composeOwnership({
    kind: ctx.kind,
    systems: ctx.systems,
    countries: ctx.countries,
    countryTypes: ctx.countryTypes,
    mapColors: ctx.mapColors,
    countryName: (country) => ctx.countryName(country.id),
  });
  return { ...ctx, owners, table };
}
