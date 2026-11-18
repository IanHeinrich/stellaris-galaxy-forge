import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/ipc");
vi.mock("../../api/events");
// The texture cache cannot fill in a static render, so each picture shows the key it asks for first.
vi.mock("../useTextureUrl", () => ({
  useTextureUrl: (keys: readonly string[]) => `tex:${keys[0]}`,
}));
vi.mock("zustand", () => import("../../test/zustandSnapshot"));

import {
  AMBIENT_OBJECTS_NEED_GAME_DATA,
  ambientObjectsUnread,
  OTHER_OBJECTS,
  PLACED_IN_SYSTEMS,
  READING_AMBIENT_OBJECTS,
} from "../../lib/ambientObjectAdd";
import { mainStarPoint } from "../../lib/details/ambientObjects";
import { bindStores } from "../../store/bindStores";
import { systemGeometry } from "../../store/systemGeometry";
import { escaped } from "../../test/elements";
import { useAmbientObjectAddStore } from "../../store/ambientObjectAdd";
import { SCENARIO_RESULT } from "../../store/fixture";
import { useGameDataStore } from "../../store/gameDataStore";
import { armSession, resetStores } from "../../store/storeFixture";
import {
  ambientObjectView,
  offCentreMainStar,
  orbitClasses,
  systemDetails,
} from "../../test/builders";
import { inSystem, openWith } from "../../test/session";
import { AddAmbientObjectDialog } from "./AddAmbientObjectDialog";

bindStores();

const dialog = () => renderToStaticMarkup(<AddAmbientObjectDialog />);

beforeEach(async () => {
  resetStores();
  armSession();
  await openWith(SCENARIO_RESULT);
  inSystem(systemDetails({ id: 0 }));
  useGameDataStore.setState({ status: "ready" });
  useAmbientObjectAddStore.setState({ prompt: { system: 0, x: 0, y: 112 }, last: null });
});

describe("the Add ambient object browser", () => {
  it("waits for the ambient objects while they are read, and says why there are none", () => {
    expect(dialog()).toContain(READING_AMBIENT_OBJECTS);

    useGameDataStore.setState({ ambientObjectsError: "the install went away" });
    expect(dialog()).toContain(escaped(ambientObjectsUnread("the install went away")));
    expect(dialog()).not.toContain(READING_AMBIENT_OBJECTS);

    useGameDataStore.setState({ status: "idle" });
    expect(dialog()).toContain(AMBIENT_OBJECTS_NEED_GAME_DATA);
  });

  it("reads the spot about an off-centre main star, as the page that opens does", () => {
    inSystem(offCentreMainStar({ id: 0 }));
    useGameDataStore.setState({ planetClasses: orbitClasses(), ambientObjects: new Map() });
    const { frame } = systemGeometry(0);
    const star = mainStarPoint(frame.layout, frame.details);
    useAmbientObjectAddStore.setState({ prompt: { system: 0, x: star.x, y: star.y + 112 } });
    expect(dialog()).toContain("At orbit 112 · 90°");
  });

  it("tells two objects of one name apart by their keys, in the list and the preview", () => {
    useGameDataStore.setState({
      ambientObjects: new Map(
        [
          ambientObjectView("drop_pod_1", { name: "Abandoned Drop Pod" }),
          ambientObjectView("drop_pod_2", { name: "Abandoned Drop Pod" }),
          ambientObjectView("derelict_ship_object", { name: "Derelict Ship" }),
        ].map((v) => [v.key, v]),
      ),
    });
    const html = dialog();
    const list = html.slice(0, html.indexOf('aria-label="Selected ambient object"'));
    expect(list).toContain("<code>drop_pod_1</code>");
    expect(list).toContain("<code>drop_pod_2</code>");
    expect(list).not.toContain("<code>derelict_ship_object</code>");
    const preview = html.slice(html.indexOf('aria-label="Selected ambient object"'));
    expect(preview).toContain("<code>drop_pod_1</code>");
  });

  it("reads the spot, lists the placed objects first, and previews the first with what places it", () => {
    useGameDataStore.setState({
      ambientObjects: new Map(
        [
          ambientObjectView("storm_object", {
            name: "Ion Storm",
            portrait: null,
            selectable: false,
          }),
          ambientObjectView("derelict_ship_object", {
            name: "Derelict Ship",
            description: "A ship adrift.",
            placed_by: ["scavenger_system"],
          }),
        ].map((v) => [v.key, v]),
      ),
    });
    const html = dialog();
    expect(html).toContain("Add an ambient object in");
    expect(html).toContain("At orbit 112 · 90°");
    expect(html).toContain('aria-label="Filter ambient objects"');
    const order = [PLACED_IN_SYSTEMS, "Derelict Ship", OTHER_OBJECTS, "Ion Storm"].map((text) =>
      html.indexOf(text),
    );
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain("tex:model:none:derelict_ship_object_entity");
    expect(html).toMatch(/<span class="megastructure-add-portrait"><\/span>/);
    const preview = html.slice(html.indexOf('aria-label="Selected ambient object"'));
    expect(preview).toContain("Derelict Ship");
    expect(preview).toContain("A ship adrift.");
    expect(preview).toContain("Visible by name");
    expect(preview).toContain("<code>scavenger_system</code>");
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Add<\/button>/);
  });
});
