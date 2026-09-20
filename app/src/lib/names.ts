import type { NameTemplate } from "../generated/NameTemplate";
import { useGameDataStore } from "../store/gameDataStore";

/** A name table: localisation keys to the text the game shows for them. */
export type Names = ReadonlyMap<string, string>;

/** Display form of a localisation key when no localised text is available. */
export function stripped(key: string): string {
  return key
    .replace(/^(NAME_|STAR_NAME_|SPEC_)/, "")
    .replace(/_/g, " ")
    .trim();
}

/** Localised text for `key` in `names`, else its stripped form. */
export function displayNameIn(names: Names, key: string): string {
  return names.get(key) ?? stripped(key);
}

/** A system's or nebula's name in `names`: literal names are shown as written, keys are localised. */
export function nodeNameIn(names: Names, name: NameTemplate): string {
  return name.literal ? name.key : displayNameIn(names, name.key);
}

/** A token the game would only ever show through localisation, never verbatim. */
const KEY_TOKEN = /^(NAME_|STAR_NAME_|SPEC_)|_/;

/**
 * Localises each whitespace-separated token of a templated name (`SPEC_Cyggan Protectors`,
 * `EMPIRE_DESIGN_humans1`) against `names`: every token is a candidate key, only key-shaped
 * ones are stripped.
 */
export function displayNameExprIn(names: Names, text: string): string {
  return text
    .split(/(\s+)/)
    .map((token) => names.get(token) ?? (KEY_TOKEN.test(token) ? stripped(token) : token))
    .join("");
}

interface Named {
  name: NameTemplate;
  name_key: string;
}

/** Looks a template's resolved text up, asking for it when it is not there yet. */
export type ResolveTemplate = (t: NameTemplate) => string | undefined;

/**
 * A templated name resolved against `names`, else the save's stand-in localised token-wise.
 * `ready` says whether game data is loaded; `resolve` gives the backend's text for a template.
 */
export function templateNameIn(
  names: Names,
  ready: boolean,
  resolve: ResolveTemplate,
  named: Named,
): string {
  if (!ready) return displayNameExprIn(names, named.name_key);
  return resolve(named.name) ?? displayNameExprIn(names, named.name_key);
}

/** Localised text for `key` when game data is loaded, else its stripped form. */
export function displayName(key: string): string {
  return displayNameIn(useGameDataStore.getState().names, key);
}

/** A system's or nebula's name: literal names are shown as written, keys are localised. */
export function nodeName(name: NameTemplate): string {
  return nodeNameIn(useGameDataStore.getState().names, name);
}

/** Localises each whitespace-separated token of a templated name against the loaded game data. */
export function displayNameExpr(text: string): string {
  return displayNameExprIn(useGameDataStore.getState().names, text);
}

/**
 * A template's place in the name cache: its shape, with the braces no localisation
 * key has, so a template and a plain key never share an entry.
 */
export function templateKey(t: NameTemplate): string {
  const variables = t.variables.map((v) => `${v.name}=${templateKey(v.value)}`).join(",");
  return `${t.literal ? "!" : ""}${t.key}{${variables}}`;
}

/** The text the backend made of `t`: its name with game data, else the save's stand-in. */
function resolved(t: NameTemplate): string | undefined {
  const state = useGameDataStore.getState();
  const text = state.names.get(templateKey(t));
  if (text === undefined) state.requestName(t);
  return text;
}

/**
 * A templated name the save gives no stand-in of its own, the search hit's owner: the
 * backend's text, localised token-wise while that text is still a stand-in. Empty until
 * the backend answers.
 */
export function displayTemplate(t: NameTemplate): string {
  const text = resolved(t);
  if (text === undefined) return "";
  return useGameDataStore.getState().status === "ready" ? text : displayNameExpr(text);
}

/** The game's sequential name: `fmt` is the key of the number format, and localisation has it. */
const SEQUENTIAL_KEY = "%SEQ%";

/**
 * Every key to localise before showing the name, depth-first: each non-literal key and
 * each variable name, since a variable name is a localisation key of its own.
 */
export function templateKeys(t: NameTemplate): string[] {
  const keys: string[] = [];
  const walk = (node: NameTemplate): void => {
    if (node.key === SEQUENTIAL_KEY) {
      const fmt = node.variables.find((v) => v.name === "fmt")?.value.key;
      if (fmt) keys.push(fmt);
      return;
    }
    if (!node.literal) keys.push(node.key);
    for (const v of node.variables) {
      keys.push(v.name);
      walk(v.value);
    }
  };
  walk(t);
  return keys;
}

/** A templated name resolved with game data, else the save's stand-in localised token-wise. */
export function templateName(named: Named): string {
  const state = useGameDataStore.getState();
  return templateNameIn(state.names, state.status === "ready", resolved, named);
}

export const planetName = templateName;
