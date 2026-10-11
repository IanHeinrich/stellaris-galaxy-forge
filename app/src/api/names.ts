import { invoke } from "@tauri-apps/api/core";

/** Each key's localisation entry as written, its `$KEY$` references kept; only the keys it has. */
export function getRawNames(keys: string[]): Promise<Record<string, string>> {
  return invoke<Record<string, string>>("get_raw_names", { keys });
}
