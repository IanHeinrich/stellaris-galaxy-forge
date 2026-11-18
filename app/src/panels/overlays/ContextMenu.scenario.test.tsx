import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/ipc");
vi.mock("../../api/events");
vi.mock("zustand", () => import("../../test/zustandSnapshot"));

import { SCENARIO_STAR_BODY } from "../../generated/constants";
import {
  ADD_AMBIENT_OBJECT_HERE_LABEL,
  AMBIENT_OBJECTS_NEED_GAME_DATA,
} from "../../lib/ambientObjectAdd";
import { SCENARIO_CAPABILITIES } from "../../lib/capabilities";
import {
  ADD_MEGASTRUCTURE_HERE_LABEL,
  ADD_MEGASTRUCTURE_LABEL,
  MAIN_STAR_ONLY,
  ROLLED_BODY_REFUSAL,
} from "../../lib/megastructureCopy";
import { useAmbientObjectAddStore } from "../../store/ambientObjectAdd";
import { bindStores } from "../../store/bindStores";
import { useFileSessionStore } from "../../store/fileSessionStore";
import {
  OPEN_RESULT,
  SCENARIO_RESULT,
  name,
  planetSummary,
  systemDetails,
} from "../../store/fixture";
import { useGameDataStore } from "../../store/gameDataStore";
import { useGeneratorStore } from "../../store/generatorStore";
import type { ContextTarget } from "../../store/mapChromeStore";
import { useMapChromeStore } from "../../store/mapChromeStore";
import { useMegastructureAddStore } from "../../store/megastructureAdd";
import { armSession, resetStores } from "../../store/storeFixture";
import {
  megastructureSummary,
  namedPlanets,
  orbitClasses,
  orbitSystem,
  solWithBelt,
} from "../../test/builders";
import { escaped, menuItem } from "../../test/elements";
import { mockedIpc } from "../../test/ipc";
import { inSystem, openWith } from "../../test/session";
import { ContextMenu } from "./ContextMenu";
import { BodyMenu } from "./contextMenu/BodyMenu";
import { SceneSpaceMenu } from "./contextMenu/SceneSpaceMenu";

bindStores();

const menu = () => renderToStaticMarkup(<ContextMenu />);

beforeEach(async () => {
  resetStores();
  armSession();
  await openWith(OPEN_RESULT);
});

describe("a scenario's system view menus", () => {
  const body = (id: number) => ({ kind: "body", system: 0, id }) as const;
  const space = { kind: "systemSpace", system: 0, x: 90, y: -120 } as const;

  function inOrbitSystem(): void {
    const details = orbitSystem({ id: 0 });
    inSystem({ ...details, planets: namedPlanets(details.planets) });
    useGameDataStore.setState({ status: "ready", planetClasses: orbitClasses() });
    useGeneratorStore.setState({
      planetClasses: [{ key: "pc_desert", name: "Desert", min_size: 10, max_size: 25 }],
      moonClasses: [{ key: "pc_barren", name: "Barren", min_size: 5, max_size: 5 }],
    });
  }

  const cases: {
    name: string;
    setup: () => void;
    /** What a save's menu on each target offers. */
    offers: [ContextTarget, string][];
    /** The name in the menu's header, which a scenario's menu keeps. */
    header?: string;
  }[] = [
    {
      name: "body deletion",
      setup: () =>
        inSystem(
          systemDetails({
            id: 0,
            planets: [planetSummary({ id: 13, name: name("Luna"), name_key: "Luna", moon: true })],
          }),
        ),
      offers: [[body(13), "Delete moon"]],
    },
    { name: "body lock", setup: inOrbitSystem, offers: [[body(2), "Lock to"]] },
    {
      name: "belt removal",
      setup: () => inSystem(solWithBelt()),
      offers: [[{ kind: "belt", system: 0, index: 0 }, "Remove belt"]],
    },
    {
      name: "belt in empty space",
      setup: () => inSystem(solWithBelt()),
      offers: [[space, "Add belt here"]],
    },
    {
      name: "megastructure page and deletion",
      setup: () => {
        inSystem(
          systemDetails({
            id: 0,
            megastructures: [megastructureSummary({ id: 6, kind: "think_tank_3" })],
          }),
        );
        useGameDataStore.setState({ names: new Map([["think_tank_3", "Science Nexus"]]) });
      },
      header: "Science Nexus",
      offers: [
        [{ kind: "megastructure", system: 0, id: 6 }, "Inspect"],
        [{ kind: "megastructure", system: 0, id: 6 }, "Delete megastructure"],
      ],
    },
    {
      name: "planet and moon",
      setup: inOrbitSystem,
      offers: [
        [space, "Add planet here"],
        [body(2), "Add moon"],
      ],
    },
  ];

  const menuOn = (target: ContextTarget) => {
    useMapChromeStore.getState().openContextMenu({ target, x: 0, y: 0 });
    return menu();
  };

  it.each(cases)(
    "offers no $name, which a save's menu offers",
    async ({ setup, offers, header }) => {
      setup();
      for (const [target, text] of offers) expect(menuOn(target)).toContain(text);

      await openWith(SCENARIO_RESULT);
      setup();
      for (const [target, text] of offers) {
        const html = menuOn(target);
        expect(html).not.toContain(text);
        expect(html).toContain(">Back to galaxy</button>");
        if (header !== undefined) {
          expect(html).toContain(`<div class="context-menu-header">${header}</div>`);
        }
      }
    },
  );

  it("offers Add ambient object in empty space where the document places them, and opens the browser at the point", async () => {
    inSystem(systemDetails({ id: 0 }));
    expect(menuOn(space)).not.toContain(ADD_AMBIENT_OBJECT_HERE_LABEL);

    await openWith(SCENARIO_RESULT);
    inSystem(systemDetails({ id: 0 }));
    expect(menuOn(space)).toMatch(/<button[^>]*disabled=""[^>]*>Add ambient object here…/);
    expect(menuOn(space)).toContain(escaped(AMBIENT_OBJECTS_NEED_GAME_DATA));

    useGameDataStore.setState({ status: "ready" });
    mockedIpc.getAmbientObjectTypes.mockResolvedValue([]);
    const html = menuOn(space);
    expect(html.indexOf(ADD_MEGASTRUCTURE_HERE_LABEL)).toBeLessThan(
      html.indexOf(ADD_AMBIENT_OBJECT_HERE_LABEL),
    );
    menuItem(
      <SceneSpaceMenu target={space} frame={{}} />,
      ADD_AMBIENT_OBJECT_HERE_LABEL,
    ).props.onClick();
    expect(useAmbientObjectAddStore.getState().prompt).toEqual({ system: 0, x: 90, y: -120 });

    useFileSessionStore.setState({
      capabilities: { ...SCENARIO_CAPABILITIES, ambient_objects: false },
    });
    expect(menuOn(space)).not.toContain(ADD_AMBIENT_OBJECT_HERE_LABEL);
  });

  it("offers Add megastructure on the main star and in empty space, and refuses any other body with its reason", async () => {
    await openWith(SCENARIO_RESULT);
    const stated = (id: number, planetClass: string, drawn = false) =>
      planetSummary({
        id,
        name: name(`Body ${id}`),
        name_key: `Body ${id}`,
        class: planetClass,
        drawn,
      });
    const [STAR, PLANET, ROLLED, SECOND] = [0, 1, 2, 3].map((n) => SCENARIO_STAR_BODY + n);
    inSystem(
      systemDetails({
        id: 0,
        planets: [
          stated(STAR, "star"),
          stated(PLANET, "pc_arid"),
          stated(ROLLED, "random", true),
          stated(SECOND, "star"),
        ],
      }),
    );
    useGameDataStore.setState({ status: "ready" });
    const prompt = () => useMegastructureAddStore.getState().prompt;

    const star = menuOn(body(SCENARIO_STAR_BODY));
    expect(star).not.toMatch(/<button[^>]*disabled=""[^>]*>Add megastructure…/);
    menuItem(
      <BodyMenu target={body(SCENARIO_STAR_BODY)} frame={{}} />,
      ADD_MEGASTRUCTURE_LABEL,
    ).props.onClick();
    expect(prompt()).toEqual({
      system: 0,
      spot: { kind: "body", body: SCENARIO_STAR_BODY, star: true, class: "star" },
    });

    menuItem(
      <SceneSpaceMenu target={space} frame={{}} />,
      ADD_MEGASTRUCTURE_HERE_LABEL,
    ).props.onClick();
    expect(prompt()).toEqual({ system: 0, spot: { kind: "space", x: 90, y: -120 } });

    for (const [id, reason] of [
      [PLANET, MAIN_STAR_ONLY],
      [ROLLED, ROLLED_BODY_REFUSAL],
      [SECOND, MAIN_STAR_ONLY],
    ] as const) {
      const html = menuOn(body(id));
      expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Add megastructure…/);
      expect(html).toContain(escaped(reason));
    }
  });
});
