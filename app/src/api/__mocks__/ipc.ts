import { vi } from "vitest";
import type { SgfError } from "../../generated/SgfError";

export type { SgfError };

/**
 * Every Tauri command as a spy, so a store test says only what the calls it exercises
 * resolve to. A command a test has not armed rejects, because the backend always answers.
 */
const command = (name: string) =>
  vi.fn(async (): Promise<never> => {
    throw new Error(`unarmed ipc mock: ${name}`);
  });

export const saveDirs = command("saveDirs");
export const listSaves = command("listSaves");
export const listCampaigns = command("listCampaigns");
export const listCampaignSaves = command("listCampaignSaves");
export const listScenarios = command("listScenarios");
export const openSave = command("openSave");
export const openAsScenario = command("openAsScenario");
export const newScenario = command("newScenario");
export const exportScenario = command("exportScenario");
export const previewExport = command("previewExport");
export const getSystem = command("getSystem");
export const search = command("search");
export const warmDetails = command("warmDetails");
export const applyOp = command("applyOp");
export const feZoneRecompute = command("feZoneRecompute");
export const undo = command("undo");
export const redo = command("redo");
export const closeSave = command("closeSave");
export const save = command("save");
export const saveAs = command("saveAs");
export const isCloudSave = command("isCloudSave");
export const loadGameData = command("loadGameData");
export const gameDataSummary = command("gameDataSummary");
export const unloadGameData = command("unloadGameData");
export const resumeAutoReload = command("resumeAutoReload");
export const getSpecialSystems = command("getSpecialSystems");
export const getEntity = command("getEntity");
export const getEntitySource = command("getEntitySource");
export const getEntitySchema = command("getEntitySchema");
export const getScenarioOwners = command("getScenarioOwners");
export const getScenarioBypasses = command("getScenarioBypasses");
export const getSystemScripts = command("getSystemScripts");
export const paintMod = command("paintMod");
export const openScript = command("openScript");
export const openUrl = command("openUrl");
export const getNames = command("getNames");
export const resolveNames = command("resolveNames");
export const getStarClasses = command("getStarClasses");
export const getDeposits = command("getDeposits");
export const getBypasses = command("getBypasses");
export const getInitializers = command("getInitializers");
export const getMapColors = command("getMapColors");
export const getPlanetClasses = command("getPlanetClasses");
export const getStarbaseLevels = command("getStarbaseLevels");
export const getShipSizes = command("getShipSizes");
export const getCountryTypes = command("getCountryTypes");
export const getResourceIcons = command("getResourceIcons");
export const getTextures = command("getTextures");
export const getSystemDetails = command("getSystemDetails");
export const checkForUpdate = command("checkForUpdate");
export const installUpdate = command("installUpdate");
export const appVersion = command("appVersion");

/** The two pure helpers keep their real behaviour: tests assert on the messages they produce. */
export { errorMessage, isSgfError } from "../errors";

/** Not a command either: the releases URL is the constant the store holds before any check. */
export { RELEASES_URL } from "../update";
