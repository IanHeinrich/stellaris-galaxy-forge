import { useSystemNames } from "../../store/browserRows";
import { rollAgain } from "../../store/commands";
import { useFileSessionStore } from "../../store/fileSessionStore";
import { useSceneStore } from "../../store/sceneStore";
import "./chrome.css";

/** What Roll again says it does, on its button and in the View menu. */
export const ROLL_AGAIN_TITLE = "Draw another roll of the system's initializer";

/**
 * "Galaxy › Sol" over the map's top-left corner while a system is shown; Galaxy leaves it. A
 * scenario system has Roll again after its name.
 */
export function SceneCrumb({ system }: { system: number }) {
  const leaveSystem = useSceneStore((s) => s.leaveSystem);
  const scenario = useFileSessionStore((s) => s.kind === "scenario");
  const [name] = useSystemNames([system]);
  return (
    <nav className="tool-options scene-crumb" aria-label="Scene">
      <button type="button" className="link" onClick={() => leaveSystem()}>
        Galaxy
      </button>
      <span className="sep" aria-hidden="true">
        ›
      </span>
      <span className="here">{name}</span>
      {scenario && (
        <>
          <span className="sep" aria-hidden="true">
            ·
          </span>
          <button type="button" className="link" title={ROLL_AGAIN_TITLE} onClick={rollAgain}>
            Roll again
          </button>
        </>
      )}
    </nav>
  );
}
