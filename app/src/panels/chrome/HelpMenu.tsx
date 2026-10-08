import { WARN_NOT_FOR_PAINT } from "../../lib/paintCopy";
import { usePaintModStore } from "../../store/paintModStore";
import { useUpdateStore } from "../../store/updateStore";
import { openGuide } from "../helpLinks";
import "./chrome.css";
import { EyeRow, Menu, MenuItem } from "./Menu";

/**
 * The app's own corner: the guide, what is running, whether it looks for something newer, and
 * where; and whether it asks before opening a scenario that isn't for Paint a Galaxy.
 */
export function HelpMenu() {
  return <Menu label="Help">{(dismiss) => <HelpMenuItems dismiss={dismiss} />}</Menu>;
}

/** Every Help command, for the open menu: `dismiss` closes it once a command is taken. */
export function HelpMenuItems({ dismiss }: { dismiss: () => void }) {
  const status = useUpdateStore((s) => s.status);
  const version = useUpdateStore((s) => s.version);
  const checkAtStart = useUpdateStore((s) => s.checkAtStart);
  const check = useUpdateStore((s) => s.check);
  const setCheckAtStart = useUpdateStore((s) => s.setCheckAtStart);
  const openReleases = useUpdateStore((s) => s.openReleases);
  const warnNotForPaint = usePaintModStore((s) => s.warnNotForPaint);
  const setWarnNotForPaint = usePaintModStore((s) => s.setWarnNotForPaint);
  const busy = status === "checking" || status === "installing";

  return (
    <>
      <div className="menu-section">Stellaris Galaxy Forge</div>
      <div className="menu-note">{version ?? "version unknown"}</div>
      <MenuItem label="User guide" dismiss={dismiss} onClick={openGuide} />
      <MenuItem
        label="Check for updates…"
        disabled={busy}
        dismiss={dismiss}
        onClick={() => check(true)}
      />
      <EyeRow pressed={checkAtStart} onClick={() => setCheckAtStart(!checkAtStart)}>
        <span>Check for updates at start</span>
      </EyeRow>
      <MenuItem label="Releases page" dismiss={dismiss} onClick={openReleases} />
      <div className="menu-rule" />
      <div className="menu-section">Paint a Galaxy</div>
      <EyeRow pressed={warnNotForPaint} onClick={() => setWarnNotForPaint(!warnNotForPaint)}>
        <span>{WARN_NOT_FOR_PAINT}</span>
      </EyeRow>
    </>
  );
}
