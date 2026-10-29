import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef, useState } from "react";
import { LOCATE_USER_DIR, lacksPlayset, USER_DIR_LABEL, userDirShown } from "../../lib/userDir";
import { useGameDataStore } from "../../store/gameDataStore";
import { HelpLink } from "../HelpLink";
import "./open.css";

const EXPLANATION =
  "The editor reads definitions, localisation and art from your Stellaris install. " +
  "With them, systems, planets and empires show their in-game names, icons and colours, " +
  "mods are recognised, and scripted systems are classified. Nothing is copied out of the " +
  "install. It takes a few seconds at each start.";

/** First launch: the one card that decides whether game data is read, before anything is. */
export function Setup() {
  const status = useGameDataStore((s) => s.status);
  const error = useGameDataStore((s) => s.error);
  const installPath = useGameDataStore((s) => s.installPath);
  const setInstallPath = useGameDataStore((s) => s.setInstallPath);
  const continueSetup = useGameDataStore((s) => s.continueSetup);
  const load = useGameDataStore((s) => s.load);
  const summary = useGameDataStore((s) => s.summary);
  const userDir = useGameDataStore((s) => s.userDir);
  const userDirRefusal = useGameDataStore((s) => s.userDirRefusal);
  const chooseUserDir = useGameDataStore((s) => s.chooseUserDir);
  const forgetUserDir = useGameDataStore((s) => s.forgetUserDir);
  const [wanted, setWanted] = useState(true);
  const go = useRef<HTMLButtonElement>(null);
  const notFound = status === "error";
  const shownDir = userDirShown(summary, userDir);
  const loading = status === "loading";
  const noPlayset = lacksPlayset(summary);

  useEffect(() => go.current?.focus(), []);

  const change = async () => {
    const picked = await open({ directory: true, multiple: false, title: "Locate Stellaris" });
    if (typeof picked !== "string") return;
    if (notFound) await load(picked);
    else setInstallPath(picked);
  };

  const changeUserDir = async () => {
    const picked = await open({ directory: true, multiple: false, title: LOCATE_USER_DIR });
    if (typeof picked === "string") await chooseUserDir(picked);
  };

  return (
    <div className="launch">
      <form
        className="setup-card"
        onSubmit={(e) => {
          e.preventDefault();
          void continueSetup(wanted);
        }}
      >
        <h1>
          {notFound ? "Stellaris was not found" : "Before you start"}{" "}
          <HelpLink place="gameDataSetup" topic="Game data" />
        </h1>
        {notFound && error && <div className="error-box">{error}</div>}
        <label className="setup-check">
          <input
            type="checkbox"
            checked={wanted}
            onChange={(e) => setWanted(e.currentTarget.checked)}
          />
          <span>
            <b>Load Stellaris game data</b>
            <span className="setup-why">{EXPLANATION}</span>
          </span>
        </label>
        <div className="setup-install">
          <span className="muted setup-label">Install</span>
          <span className="setup-path">
            {installPath ?? <span className="muted">found automatically when you continue</span>}
          </span>
          {notFound && <span className="warn">not found</span>}
          <button type="button" className="link" onClick={() => void change()}>
            {notFound ? "Locate Stellaris…" : "Change install…"}
          </button>
        </div>
        <div className="setup-install">
          <span className="muted setup-label">{USER_DIR_LABEL}</span>
          <span className="setup-path">
            {shownDir?.path ?? (
              <span className="muted">
                {summary ? "none found" : "found automatically when you continue"}
              </span>
            )}
          </span>
          {shownDir?.note && <span className="muted">{shownDir.note}</span>}
          {noPlayset && <span className="warn">no mods found</span>}
          {!loading && (
            <button type="button" className="link" onClick={() => void changeUserDir()}>
              {noPlayset ? `${LOCATE_USER_DIR}…` : "Change folder…"}
            </button>
          )}
          {!loading && userDir !== undefined && (
            <button type="button" className="link" onClick={() => void forgetUserDir()}>
              Use the default folder
            </button>
          )}
        </div>
        {userDirRefusal && <div className="error-box">{userDirRefusal}</div>}
        <div className="dialog-actions">
          <span className="hint">You can change this later under Game data in the status bar.</span>
          <button type="submit" ref={go} disabled={status === "loading"}>
            Continue
          </button>
        </div>
      </form>
    </div>
  );
}
