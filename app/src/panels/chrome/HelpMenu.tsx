import { useUpdateStore } from "../../store/updateStore";
import "./chrome.css";
import { EyeRow, Menu, MenuItem } from "./Menu";

/** The app's own corner: what is running, whether it looks for something newer, and where. */
export function HelpMenu() {
  const status = useUpdateStore((s) => s.status);
  const version = useUpdateStore((s) => s.version);
  const checkAtStart = useUpdateStore((s) => s.checkAtStart);
  const check = useUpdateStore((s) => s.check);
  const setCheckAtStart = useUpdateStore((s) => s.setCheckAtStart);
  const openReleases = useUpdateStore((s) => s.openReleases);
  const busy = status === "checking" || status === "installing";

  return (
    <Menu label="Help" align="right">
      {(dismiss) => (
        <>
          <div className="menu-section">Stellaris Galaxy Forge</div>
          <div className="menu-note">{version ?? "version unknown"}</div>
          <MenuItem
            label="Check for updates…"
            disabled={busy}
            onClick={() => {
              dismiss();
              void check(true);
            }}
          />
          <EyeRow pressed={checkAtStart} onClick={() => setCheckAtStart(!checkAtStart)}>
            <span>Check for updates at start</span>
          </EyeRow>
          <div className="menu-rule" />
          <MenuItem
            label="Releases page"
            onClick={() => {
              dismiss();
              void openReleases();
            }}
          />
        </>
      )}
    </Menu>
  );
}
