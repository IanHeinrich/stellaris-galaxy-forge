import { useSystemNames } from "../../store/browserRows";
import { useSceneStore } from "../../store/sceneStore";
import "./chrome.css";

/** "Galaxy › Sol" over the map's top-left corner while a system is shown; Galaxy leaves it. */
export function SceneCrumb({ system }: { system: number }) {
  const leaveSystem = useSceneStore((s) => s.leaveSystem);
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
    </nav>
  );
}
