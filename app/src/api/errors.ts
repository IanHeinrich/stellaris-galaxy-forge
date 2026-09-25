import type { SgfError } from "../generated/SgfError";

/** True when `e` is a command failure from the Rust side. */
export function isSgfError(e: unknown): e is SgfError {
  return (
    typeof e === "object" &&
    e !== null &&
    "kind" in e &&
    "message" in e &&
    typeof (e as SgfError).message === "string"
  );
}

/** The text of a rejection: an `SgfError`'s message, an `Error`'s, else the value itself. */
export function errorMessage(e: unknown): string {
  if (isSgfError(e)) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}
