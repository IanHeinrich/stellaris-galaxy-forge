/**
 * Preparing the open scenario for a new game.
 * Command and argument names match `app/src-tauri/src/commands/prepare.rs`.
 */
import { invoke } from "@tauri-apps/api/core";
import type { PreparedEdit } from "../generated/PreparedEdit";
import type { PrepareOptions } from "../generated/PrepareOptions";
import type { PreparePreview } from "../generated/PreparePreview";
import type { RowChoice } from "../generated/RowChoice";

/**
 * What `choices` under `options` would do to the open scenario: each row's systems, how many
 * systems the one edit would change, the systems the options make plain and the systems it cuts
 * off. Rejects with `SgfError` (kind `op`) without game data or on a save.
 */
export function preparePreview(
  choices: RowChoice[],
  options: PrepareOptions,
): Promise<PreparePreview> {
  return invoke<PreparePreview>("prepare_preview", { choices, options });
}

/**
 * Write `choices` under `options` over the open scenario as one edit, one undo step, with how
 * many systems it changed; null when they change nothing. Without `options` the core's defaults
 * apply. Rejects as `preparePreview` does.
 */
export function prepareApply(
  choices: RowChoice[],
  options?: PrepareOptions,
): Promise<PreparedEdit | null> {
  return invoke<PreparedEdit | null>("prepare_apply", { choices, options });
}
