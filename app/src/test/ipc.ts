import { vi } from "vitest";

import { confirm, open, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { onGameDataChanged, onProgress } from "../api/events";
import * as ipc from "../api/ipc";

/** Every command, event and dialog a test arms, each as its typed spy. */
export const mockedIpc = {
  ...vi.mocked(ipc),
  onProgress: vi.mocked(onProgress),
  onGameDataChanged: vi.mocked(onGameDataChanged),
  confirm: vi.mocked(confirm),
  open: vi.mocked(open),
  saveDialog: vi.mocked(saveDialog),
};
