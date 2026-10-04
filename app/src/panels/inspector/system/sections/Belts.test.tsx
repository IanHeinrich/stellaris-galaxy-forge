import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../api/ipc");
vi.mock("../../../../api/events");
vi.mock("../../../useTextureUrl", () => ({ useTextureUrl: () => undefined }));
vi.mock("zustand", () => import("../../../../test/zustandSnapshot"));
vi.mock("react/jsx-dev-runtime", () => import("../../../../test/drawn"));

import { bindStores } from "../../../../store/bindStores";
import { editResult } from "../../../../store/fixture";
import { useGameDataStore } from "../../../../store/gameDataStore";
import { beltKind, gameDataSummary } from "../../../../test/builders";
import { drawnBy, drawnButton, drawnField } from "../../../../test/drawn";
import { mockedIpc } from "../../../../test/ipc";
import { PickerField, TextField } from "../../../EditField";
import { useMapChromeStore } from "../../../../store/mapChromeStore";
import {
  details,
  land,
  open,
  overview,
  planet,
  resetStores,
  sections,
} from "../../inspectorFixture";
import { BeltSection } from "./Belts";

bindStores();

const BELTED = details({
  planets: [planet(100, "Tarkin")],
  belts: [
    { kind: "rocky_asteroid_belt", inner_radius: 80 },
    { kind: "icy_asteroid_belt", inner_radius: 120.5 },
  ],
  inner_radius: 200,
});

const KINDS = [
  beltKind("rocky_asteroid_belt", "Rocky Asteroid Belt"),
  beltKind("icy_asteroid_belt", "Icy Asteroid Belt", { look: "icy", emissive: true }),
  beltKind("crystal_asteroid_belt", "Crystal Asteroid Belt", { look: "crystal" }),
];

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  resetStores();
});

describe("a save system's belts", () => {
  it("follow the planets with the inner radius, each belt's kind and radius, and a remove button", async () => {
    await open("save");
    useGameDataStore.setState({ summary: gameDataSummary({ belt_kinds: KINDS }) });
    await land(BELTED);

    const html = drawnBy(overview);
    const titles = sections(html);
    expect(titles).toContain("Belts · 2");
    expect(titles.indexOf("Belts · 2")).toBe(titles.findIndex((t) => t.startsWith("Planets")) + 1);
    expect(html).toMatch(/<input type="number"[^>]*aria-label="Inner radius"[^>]*value="200"/);
    expect(html).toContain('aria-label="Belt 1 kind: Rocky Asteroid Belt"');
    expect(html).toContain('aria-label="Belt 2 kind: Icy Asteroid Belt"');
    expect(html).toMatch(/<input type="number"[^>]*aria-label="Belt 2 radius"[^>]*value="120.5"/);
    expect(html).toContain('aria-label="Remove belt 2"');
    expect(html).not.toContain("can&#x27;t edit yet");

    expect(drawnField(PickerField, "Belt 1 kind").items.map((item) => item.label)).toEqual([
      "Rocky Asteroid Belt",
      "Icy Asteroid Belt",
      "Crystal Asteroid Belt",
    ]);
    mockedIpc.applyOp.mockResolvedValue(editResult());
    drawnButton("Remove belt 2").onClick();
    await vi.waitFor(() =>
      expect(mockedIpc.applyOp).toHaveBeenCalledWith({
        type: "RemoveBelt",
        system: BELTED.id,
        index: 1,
      }),
    );
  });

  it("keeps a refused inner radius to the page, out of the status bar", async () => {
    await open("save");
    await land(BELTED);

    drawnBy(overview);
    const inner = drawnField(TextField, "Inner radius") as { onCommit(radius: number): void };
    inner.onCommit(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(mockedIpc.applyOp).not.toHaveBeenCalled();
    expect(useMapChromeStore.getState().sceneHint).toBeNull();
  });

  it("locks a belt's kind without game data, keeping its radius to edit", async () => {
    await open("save");
    useGameDataStore.setState({ summary: null });
    await land(BELTED);

    const html = overview();
    expect(html).toContain("can&#x27;t edit yet");
    expect(html).toContain('<span class="mono">rocky_asteroid_belt</span>');
    expect(html).not.toContain('aria-label="Belt 1 kind');
    expect(html).toMatch(/aria-label="Belt 1 radius"[^>]*value="80"/);
  });

  it("is plain text where nothing can be edited, and the scenario overview leaves it out", async () => {
    await open("scenario");
    useGameDataStore.setState({ summary: gameDataSummary({ belt_kinds: KINDS }) });
    await land(BELTED);

    const html = renderToStaticMarkup(<BeltSection details={BELTED} />);
    expect(html).toContain("Belts · 2");
    expect(html).toContain("Rocky Asteroid Belt");
    expect(html).toContain("radius 120.5");
    expect(html).not.toContain("edit-field");
    expect(html).not.toContain("Remove belt");

    expect(sections(overview())).not.toContain("Belts · 2");
  });
});
