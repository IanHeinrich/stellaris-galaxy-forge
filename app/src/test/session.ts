import type { GalaxyView } from "../generated/GalaxyView";
import type { OpenResult } from "../generated/OpenResult";
import { useFileSessionStore } from "../store/fileSessionStore";
import { mocked } from "../store/storeFixture";

type Opened = OpenResult & { path: string };

/** What a test changes of an opened file: any field, and any field of its galaxy. */
export type OpenPatch = Partial<Omit<Opened, "galaxy">> & { galaxy?: Partial<GalaxyView> };

/** Opens `result` with `patch` laid over it, as the session opens a file the user picked. */
export async function openWith(result: Opened, patch: OpenPatch = {}): Promise<void> {
  const opened: Opened = { ...result, ...patch, galaxy: { ...result.galaxy, ...patch.galaxy } };
  mocked.openSave.mockResolvedValue(opened);
  await useFileSessionStore.getState().openSave(opened.path);
}
