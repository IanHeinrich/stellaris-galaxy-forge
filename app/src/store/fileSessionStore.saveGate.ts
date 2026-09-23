import { confirm } from "@tauri-apps/plugin-dialog";
import type { StoreApi } from "zustand";
import { blocksSave } from "../lib/issues";
import type { FileSessionState, SaveIssuesAnswer } from "./fileSessionStore";
import { issueKey, useIssuesStore } from "./issuesStore";
import { useLayoutStore } from "./layoutStore";

export type SessionApi = Pick<StoreApi<FileSessionState>, "getState" | "setState">;

type SaveGateActions = Pick<
  FileSessionState,
  "answerSaveIssues" | "resumePausedSave" | "dismissPausedSave"
>;

const CLOUD_WARNING =
  "This file is in Steam's cloud folder. Steam can overwrite it with the cloud copy. " +
  "Close Steam or disable Steam Cloud for Stellaris before you play it. Save anyway?";

/** What the user says to the questions a save asks before it writes. */
export function saveGateActions({ getState, setState }: SessionApi): SaveGateActions {
  return {
    answerSaveIssues(answer) {
      const prompt = getState().saveIssuesPrompt;
      if (prompt === null) return;
      setState({ saveIssuesPrompt: null });
      prompt.resolve(answer);
    },

    async resumePausedSave() {
      const { pausedSave, dismissedIssues } = getState();
      if (pausedSave === null) return;
      setState({
        pausedSave: null,
        dismissedIssues: [...new Set([...dismissedIssues, ...pausedSave.keys])],
      });
      await pausedSave.resume();
    },

    dismissPausedSave() {
      if (getState().pausedSave !== null) setState({ pausedSave: null });
    },
  };
}

/**
 * Resolves true when the document may be saved with its warnings and errors: every one of them
 * was already agreed to, or the user agreed now. `resume` is the save itself, kept for the bar
 * the Issues tab shows when the user goes to look at them instead.
 */
export async function confirmIssues(
  { getState, setState }: SessionApi,
  resume: () => Promise<void>,
): Promise<boolean> {
  const { dismissedIssues, saveIssuesPrompt } = getState();
  if (saveIssuesPrompt !== null) return false;
  const unresolved = useIssuesStore.getState().issues.filter(blocksSave);
  const keys = unresolved.map(issueKey);
  if (keys.every((key) => dismissedIssues.includes(key))) return true;
  const count = unresolved.length;
  const answer = await new Promise<SaveIssuesAnswer>((resolve) => {
    setState({ saveIssuesPrompt: { count, resolve } });
  });
  if (answer === "save") {
    setState({ dismissedIssues: [...new Set([...dismissedIssues, ...keys])] });
    return true;
  }
  if (answer === "review") {
    const layout = useLayoutStore.getState();
    layout.setTab("issues");
    layout.expandDock();
    useIssuesStore.getState().flash();
    setState({ pausedSave: { count, keys, resume } });
  }
  return false;
}

/** Resolves true when `path` may be written: already acknowledged this session, or the user agreed now. */
export async function confirmCloudWrite(
  { getState, setState }: SessionApi,
  path: string,
): Promise<boolean> {
  if (getState().cloudAcknowledged === path) return true;
  const ok = await confirm(CLOUD_WARNING, { title: "Steam Cloud save", kind: "warning" });
  if (ok) setState({ cloudAcknowledged: path });
  return ok;
}
