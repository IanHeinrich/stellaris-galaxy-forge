import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/ipc");
vi.mock("../../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../../api/__mocks__/dialog"));
vi.mock("zustand", () => import("../../test/zustandSnapshot"));

import { bindStores } from "../../store/bindStores";
import { useEditorStore } from "../../store/editorStore";
import { FeZoneFitDialog } from "./FeZoneFitDialog";

bindStores();

const dialog = () => renderToStaticMarkup(<FeZoneFitDialog />);

beforeEach(() => {
  useEditorStore.setState({ ...useEditorStore.getInitialState() });
});

describe("the fit fallen empire zones dialog", () => {
  it("starts on the automatic zones standing now, and offers to fit that many", () => {
    useEditorStore.setState({ feZoneFitPrompt: { candidates: 7, automatic: 3 } });

    const html = dialog();
    expect(html).toContain('aria-label="Zones to fit"');
    expect(html).toContain('max="7"');
    expect(html).toContain('value="3"');
    expect(html).toContain("3 of 7");
    expect(html).toContain(">Fit 3 zones</button>");
    expect(html).toContain("Zones you placed by hand stay.");
  });

  it("starts on every candidate while no automatic zone stands", () => {
    useEditorStore.setState({ feZoneFitPrompt: { candidates: 4, automatic: 0 } });

    const html = dialog();
    expect(html).toContain('value="4"');
    expect(html).toContain("4 of 4");
    expect(html).toContain(">Fit 4 zones</button>");
  });

  it("names one zone in the singular", () => {
    useEditorStore.setState({ feZoneFitPrompt: { candidates: 4, automatic: 1 } });

    expect(dialog()).toContain(">Fit 1 zone</button>");
  });

  it("says there is no room and refuses to fit when the mod has no candidate", () => {
    useEditorStore.setState({ feZoneFitPrompt: { candidates: 0, automatic: 0 } });

    const html = dialog();
    expect(html).toContain("No room for a zone");
    expect(html).toContain('type="submit" disabled=""');
    expect(html).toContain("0 of 0");
  });
});
