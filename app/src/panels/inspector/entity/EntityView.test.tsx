import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EntityView as EntityViewData } from "../../../generated/EntityView";
import type { InspectorTab } from "../../../store/inspectorStore";

vi.mock("../../../api/ipc");
vi.mock("../../../api/events");
vi.mock("../../useTextureUrl", () => ({ useTextureUrl: () => undefined }));
vi.mock("zustand", () => import("../../../test/zustandSnapshot"));

import { useEntityStore, viewKey } from "../../../store/entityStore";
import {
  contentsRow,
  entityAddrOf,
  entityNode,
  entitySchema,
  entitySource,
  entityView,
  fact,
  fieldSchema,
  scalar,
} from "../../../store/fixture";
import { useInspectorStore, type Entry } from "../../../store/inspectorStore";
import { EntityView } from "./EntityView";

const PLANET = entityAddrOf("planet");
const FLEET = entityAddrOf("fleet");
const STARBASE = entityAddrOf("starbase");
const MEGASTRUCTURE = entityAddrOf("megastructure");

beforeEach(() => {
  useEntityStore.getState().clear();
  useInspectorStore.setState(useInspectorStore.getInitialState());
});

/** Lands one level of one entity, the way an answered `get_entity` does. */
function land(view: EntityViewData): void {
  const views = new Map(useEntityStore.getState().views);
  useEntityStore.setState({ views: views.set(viewKey(view.addr, view.path), view) });
}

/** Renders `entry` on `tab`, with the map's system under it as the stack always has. */
function show(entry: Entry, tab: InspectorTab): string {
  useInspectorStore.setState({
    stack: [{ ref: { kind: "system", id: 452 }, label: "Sol" }, entry],
    tab,
  });
  return renderToStaticMarkup(<EntityView entry={entry} />);
}

describe("a planet", () => {
  it("reads its curated facts, drills from a reference and badges what an edit rewrote", () => {
    land(
      entityView("planet", {
        dirty: true,
        overview: [
          fact("Class", "Continental"),
          fact("Owner", "Commonwealth of Man", { link: { kind: "country", id: 12 } }),
          fact("Colonised", "2200.03.02", { path: ["colonize_date"] }),
        ],
        nodes: [entityNode("colonize_date", scalar("2200.03.02", "date"), { changed: true })],
      }),
    );

    const html = show({ ref: { kind: "planet", id: PLANET.id }, label: "Earth" }, "overview");
    expect(html).toContain("Earth");
    expect(html).toContain("Continental");
    expect(html).toContain("Commonwealth of Man ›");
    expect(html).toContain('title="Open country #12"');
    expect(html).toContain("ins-badge");
  });

  it("says so while the read is still out", () => {
    const html = show({ ref: { kind: "planet", id: PLANET.id }, label: "Earth" }, "overview");
    expect(html).toContain("Reading the planet");
  });
});

describe("a fleet", () => {
  it("lists what it contains, its ships behind one row that drills into the list", () => {
    land(
      entityView("fleet", {
        contents: [
          contentsRow("Ships", 15, { path: ["ships"], of: "ship" }),
          contentsRow("Owner", 1, { link: { kind: "country", id: 12 } }),
          contentsRow("Orders", 0, { path: ["current_order"] }),
        ],
      }),
    );

    const html = show({ ref: { kind: "fleet", id: FLEET.id }, label: "Home Fleet" }, "contents");
    expect(html).toContain("Ships");
    expect(html).toContain(">15<");
    expect(html).toContain('class="ins-drow" role="button"');
    // A row with nothing behind it stays where it is.
    expect(html).toContain('class="ins-drow static"');
  });
});

describe("a starbase", () => {
  it("shows every field the save wrote, marks the unknown ones and drills a reference", () => {
    useEntityStore.setState({
      schemas: new Map([
        [
          "starbase",
          entitySchema("starbase", [
            fieldSchema("station", { label: "station", ty: "reference", reference: "ship" }),
            fieldSchema("level", { label: "level", ty: "enum" }),
            fieldSchema("owner", { label: "owner", ty: "reference", reference: "country" }),
            fieldSchema("mia_from", { label: "mia_from", ty: "reference", reference: "system" }),
          ]),
        ],
      ]),
    });
    land(
      entityView("starbase", {
        nodes: [
          entityNode("level", scalar("starbase_level_starport")),
          entityNode("station", scalar("4001", "int")),
          entityNode("modules", { kind: "block", count: 2 }),
          entityNode("owner", scalar("4294967295", "int"), { changed: true }),
          entityNode("mia_from", scalar("none", "null")),
        ],
      }),
    );

    const html = show(
      { ref: { kind: "starbase", system: 452, id: STARBASE.id }, label: "Bastion" },
      "data",
    );
    expect(html).toContain("starbase_level_starport");
    expect(html).toContain("#4001 ›");
    expect(html).toContain('title="Open ship #4001"');
    expect(html).toContain("2 ›");
    expect(html).toContain("raw");
    expect(html).toContain('title="no reference"');
    // `none` is a reference to nothing, not an id to drill to.
    expect(html).not.toContain("#none");
    expect(html).toContain("ins-badge");
  });
});

describe("a megastructure", () => {
  it("shows its own text with the ranges an op changed marked, and says when it was cut", () => {
    const text = "megastructure={\n\tcoordinate={ x=1 y=2 }\n}";
    useEntityStore.setState({
      sources: new Map([
        [
          `megastructure:${MEGASTRUCTURE.id}`,
          entitySource("megastructure", { text, changed: [[17, 39]], truncated: true }),
        ],
      ]),
    });

    const html = show(
      { ref: { kind: "megastructure", id: MEGASTRUCTURE.id }, label: "Ring World" },
      "source",
    );
    expect(html).toContain('<mark class="ins-changed" title="changed by an edit">');
    expect(html).toContain("coordinate={ x=1 y=2 }");
    expect(html).toContain("Showing the first mebibyte");
  });
});

describe("a node list", () => {
  it("is a level of its own, and each id in it drills to the entity it names", () => {
    const addr = { kind: "fleet" as const, id: FLEET.id };
    land(
      entityView("fleet", {
        addr,
        path: ["ships"],
        nodes: [
          entityNode(null, scalar("4001", "int"), { path: ["ships", "#0"] }),
          entityNode(null, scalar("4002", "int"), { path: ["ships", "#1"] }),
        ],
      }),
    );

    const html = show(
      { ref: { kind: "nodelist", parent: addr, path: ["ships"], of: "ship" }, label: "Ships" },
      "data",
    );
    expect(html).toContain("#4001 ›");
    expect(html).toContain("#4002 ›");
  });
});
