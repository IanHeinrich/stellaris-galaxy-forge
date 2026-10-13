import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../api/ipc");
vi.mock("../../../api/events");
// The row icons come from the map's texture cache, which no test renderer can fill.
vi.mock("../../useTextureUrl", () => ({ useTextureUrl: () => undefined }));
vi.mock("zustand", () => import("../../../test/zustandSnapshot"));

import type { InitializerDefinition } from "../../../generated/InitializerDefinition";
import { bindStores } from "../../../store/bindStores";
import { useGalaxyStore } from "../../../store/galaxyStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { useInspectorStore } from "../../../store/inspectorStore";
import { useScriptEditorStore } from "../../../store/scriptEditorStore";
import { initializerView } from "../../../test/builders";
import { drawnBy, drawnButton } from "../../../test/drawn";
import { mockedIpc } from "../../../test/ipc";
import { bodySpawn } from "../../../test/spawn";
import {
  details,
  land,
  open,
  overview,
  patchSystem,
  planet,
  resetStores,
  SYSTEM,
} from "../inspectorFixture";
import { useInitializerDefinitions } from "../../../store/initializerDefinitionStore";
import { answerPage, render } from "./bodyPageFixture";
import { name, planetPage } from "../../../store/fixture";

bindStores();

const FILE = "C:/Stellaris/common/solar_system_initializers/basic_init.txt";
const GAS_GIANT = "C:/Stellaris/common/inline_scripts/planets/gas_giant.txt";
const VS_CODE = { kind: "found", id: "vscode" } as const;

/** `basic_init_01` at line 120 of its file: a planet, an inline script, then a second planet. */
const DEFINITION: InitializerDefinition = {
  name: "basic_init_01",
  text: [
    "basic_init_01 = {",
    "\tclass = sc_g",
    "\tplanet = {",
    "\t\tclass = pc_continental",
    "\t\tsize = 16",
    "\t}",
    '\tinline_script = "planets/gas_giant"',
    "\tplanet = {",
    "\t\tclass = pc_barren",
    "\t\tmoon = { class = pc_frozen }",
    "\t}",
    "}",
  ].join("\n"),
  at: { file: FILE, line: 120 },
  inline_scripts: [{ line: 7, script: "planets/gas_giant", file: { file: GAS_GIANT, line: 1 } }],
};

function landDefinition(definition: InitializerDefinition = DEFINITION): void {
  useInitializerDefinitions.setState({
    version: useGameDataStore.getState().version,
    reads: new Map([["basic_init_01", { definition }]]),
  });
}

function rememberVsCode(): void {
  useScriptEditorStore.setState({ choice: { pick: VS_CODE, name: "VS Code", remember: true } });
  mockedIpc.openInEditor.mockResolvedValue({ fell_back: false, steam_replaces: false });
}

/** The numbers, from 1, of the snippet lines drawn with the line bar. */
function markedLines(html: string): number[] {
  const lines = [...html.matchAll(/<span class="snippet-line([^"]*)"/g)].map((m) => m[1]);
  return lines.flatMap((classes, i) => (classes.includes("marked") ? [i + 1] : []));
}

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  resetStores();
  useScriptEditorStore.setState({ ...useScriptEditorStore.getInitialState() });
  useInitializerDefinitions.setState({ ...useInitializerDefinitions.getInitialState() });
  useGameDataStore.setState({
    initializers: [initializerView({ name: "basic_init_01", source: FILE })],
  });
});

describe("the Initializer section's Open button", () => {
  it("is named for the remembered editor and opens the definition's line", async () => {
    await open("scenario");
    landDefinition();
    rememberVsCode();

    const html = drawnBy(overview);
    expect(html).toContain(`<button type="button" class="link" title="${FILE}">Open in VS Code`);
    drawnButton(FILE).onClick();
    await vi.waitFor(() => expect(mockedIpc.openInEditor).toHaveBeenCalledWith(FILE, 120, VS_CODE));
  });

  it("opens the top of the file until the definition is read", async () => {
    await open("scenario");
    rememberVsCode();

    drawnBy(overview);
    drawnButton(FILE).onClick();
    await vi.waitFor(() =>
      expect(mockedIpc.openInEditor).toHaveBeenCalledWith(FILE, null, VS_CODE),
    );
  });
});

describe("a system's Source tab", () => {
  it("shows the initializer's definition under the system's text, whole, with its file", async () => {
    await open("scenario");
    landDefinition();
    useInspectorStore.setState({ tab: "source" });

    const html = drawnBy(overview);
    expect(html).toContain(
      `<div class="ins-init-head"><span class="mono ins-init-name">basic_init_01</span><span class="muted ins-init-file" title="${FILE}">basic_init.txt</span></div>`,
    );
    expect(html).toContain('<span class="snippet-where">line 120</span>');
    expect(html).toContain('<span class="snippet-key">inline_script</span>');
    expect(html).not.toContain("Show all");
    expect(markedLines(html)).toEqual([]);
  });

  it("links each inline script to its file and line", async () => {
    await open("save");
    landDefinition();
    rememberVsCode();
    useInspectorStore.setState({ tab: "source" });

    const html = drawnBy(overview);
    expect(html).toContain(
      '<button type="button" class="link snippet-link" title="Open in VS Code">planets/gas_giant</button></span>',
    );
    drawnButton("planets/gas_giant").onClick();
    await vi.waitFor(() =>
      expect(mockedIpc.openInEditor).toHaveBeenCalledWith(GAS_GIANT, 1, VS_CODE),
    );
  });

  it("says so in one line when the definition can't be read", async () => {
    await open("scenario");
    useInitializerDefinitions.setState({
      reads: new Map([["basic_init_01", { error: "no initializer basic_init_01" }]]),
    });
    useInspectorStore.setState({ tab: "source" });

    expect(overview()).toContain(
      '<div class="muted ins-hint">The initializer basic_init_01&#x27;s definition could not be read: no initializer basic_init_01</div>',
    );
  });

  it("shows nothing more for a system with no initializer, or without game data", async () => {
    await open("scenario");
    landDefinition();
    useInspectorStore.setState({ tab: "source" });
    const { initializer } = useGalaxyStore.getState().systems.get(SYSTEM)!;
    patchSystem(SYSTEM, { initializer: "" });
    expect(overview()).not.toContain("ins-init-source");
    expect(overview()).not.toContain("initializer");

    patchSystem(SYSTEM, { initializer });
    useGameDataStore.setState({ status: "idle" });
    expect(overview()).not.toContain("ins-init-source");
  });
});

describe("a body's Source tab", () => {
  it("marks a scenario body's block in its system's initializer", async () => {
    await open("scenario");
    landDefinition();
    const second = planet(101, "", {
      spawn: bodySpawn({ at: { file: FILE.replace(/\//g, "\\"), line: 127, last: 130 } }),
    });
    await land(details({ planets: [second] }));

    const html = drawnBy(() => render(101, "source"));
    expect(html).toContain('<span class="mono ins-init-name">basic_init_01</span>');
    expect(markedLines(html)).toEqual([8, 9, 10, 11]);
  });

  it("marks the inline_script line of a body that script places", async () => {
    await open("scenario");
    landDefinition();
    const scripted = planet(101, "", {
      spawn: bodySpawn({ from_script: "planets/gas_giant", at: { file: GAS_GIANT, line: 3 } }),
    });
    await land(details({ planets: [scripted] }));

    const html = drawnBy(() => render(101, "source"));
    expect(html).toContain('<span class="mono ins-init-name">basic_init_01</span>');
    expect(markedLines(html)).toEqual([7]);
  });

  it("shows a save body's own text with its system's initializer below, unmarked", async () => {
    await open("save");
    landDefinition();
    await land(details({ planets: [planet(100, "Tarkin")] }));

    const html = drawnBy(() => render(100, "source"));
    expect(html).toContain('<div class="ins-sub muted">planet</div>');
    expect(html).toContain('<span class="mono ins-init-name">basic_init_01</span>');
    expect(markedLines(html)).toEqual([]);
  });
});

describe("a body page's Open button", () => {
  it("opens a scenario body's block at the line its spawn names", async () => {
    await open("scenario");
    rememberVsCode();
    const at = { file: FILE, line: 127 };
    await land(details({ planets: [planet(101, "", { spawn: bodySpawn({ at }) })] }));

    const html = drawnBy(() => render(101));
    expect(html).toContain(`title="${FILE}">Open in VS Code</button>`);
    drawnButton(FILE).onClick();
    await vi.waitFor(() => expect(mockedIpc.openInEditor).toHaveBeenCalledWith(FILE, 127, VS_CODE));
  });

  it("is not on a save body's page", async () => {
    await open("save");
    await land(details({ planets: [planet(100, "Tarkin")] }));
    await answerPage(planetPage({ id: 100, name: name("Tarkin"), name_key: "Tarkin" }));

    const html = render(100);
    expect(html).toContain('<span class="name">');
    expect(html).not.toContain("Open file");
    expect(html).not.toContain("Open in");
  });
});
