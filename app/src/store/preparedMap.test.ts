import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");

import type { PreparedMap } from "../generated/PreparedMap";
import type { PreparePreview } from "../generated/PreparePreview";
import { appIssue, byId, placedNode, systemNode } from "../test/builders";
import { useGalaxyStore } from "./galaxyStore";
import { useIssuesStore } from "./issuesStore";
import { mapDelta, mapIssues, projectionDelta } from "./preparedMap";
import { usePrepareStore } from "./prepareStore";

const kept = {
  galaxy: useGalaxyStore.getState(),
  issues: useIssuesStore.getState(),
  prepare: usePrepareStore.getState(),
};

afterEach(() => {
  useGalaxyStore.setState(kept.galaxy, true);
  useIssuesStore.setState(kept.issues, true);
  usePrepareStore.setState(kept.prepare, true);
});

/** The map Prepare's choices would leave, with `rewritten` among its systems. */
function projection(...rewritten: ReturnType<typeof systemNode>[]): PreparedMap {
  return {
    systems: rewritten,
    special: [],
    bypasses: {
      bypasses: [],
      open_endpoints: 0,
      random_wormhole_pairs: 0,
      random_gateways: 0,
      with_game_data: true,
    },
  };
}

function show(map: PreparedMap): void {
  const preview = { map } as PreparePreview;
  usePrepareStore.setState({ outcomeShown: true, preview });
}

describe("the issues the map marks", () => {
  it("are the document's, and none while the map shows Prepare's outcome", () => {
    const issues = [appIssue()];
    useIssuesStore.setState({ issues });
    expect(mapIssues()).toBe(issues);
    show(projection());
    expect(mapIssues()).toEqual([]);
  });
});

describe("a delta as the map shows it", () => {
  it("takes each system from the projection while it shows, and drops one the map lacks", () => {
    const own = placedNode(1, 0, 0);
    useGalaxyStore.setState({ systems: byId(own, placedNode(2, 5, 5)) });
    expect(mapDelta({ systems: [own] }).systems).toEqual([own]);
    const rewritten = { ...own, initializer: "random" };
    show(projection(rewritten));
    expect(mapDelta({ systems: [own, placedNode(3, 9, 9)] }).systems).toEqual([rewritten]);
  });

  it("covers the systems either projection rewrites, once each", () => {
    const first = placedNode(1, 0, 0);
    const second = placedNode(2, 5, 5);
    useGalaxyStore.setState({ systems: byId(first, second) });
    show(projection(first, second));
    const before = projection(first);
    const after = projection(first, second);
    expect(projectionDelta(before, after).systems.map((s) => s.id)).toEqual([1, 2]);
  });
});
