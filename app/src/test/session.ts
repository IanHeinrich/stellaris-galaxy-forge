import type { GalaxyView } from "../generated/GalaxyView";
import type { OpenResult } from "../generated/OpenResult";
import { useFileSessionStore } from "../store/fileSessionStore";
import { mockedIpc } from "./ipc";

type Opened = OpenResult & { path: string };

/** What a test changes of an opened file: any field, and any field of its galaxy. */
export type OpenPatch = Partial<Omit<Opened, "galaxy">> & { galaxy?: Partial<GalaxyView> };

/** Opens `result` with `patch` laid over it, as the session opens a file the user picked. */
export async function openWith(result: Opened, patch: OpenPatch = {}): Promise<void> {
  const opened: Opened = { ...result, ...patch, galaxy: { ...result.galaxy, ...patch.galaxy } };
  mockedIpc.openSave.mockResolvedValue(opened);
  await useFileSessionStore.getState().openSave(opened.path);
}

/** The session as it stands once `result` has opened, for a test that drives no command. */
export function readyAs(result: Opened): void {
  useFileSessionStore.setState({
    status: "ready",
    kind: result.kind,
    path: result.path,
    capabilities: result.capabilities,
  });
}
