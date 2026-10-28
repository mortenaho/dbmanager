import { useEffect, useState } from "react";
import { clearHistory, loadSettings, saveSettings } from "../api";
import { errorText } from "../types";

const CHOICES = [
  { days: 1, label: "1 day" },
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 365, label: "1 year" },
  { days: 0, label: "Never" },
];

type Props = {
  onClose: () => void;
  onSaved: (message: string) => void;
};

export function SettingsDialog({ onClose, onSaved }: Props) {
  const [days, setDays] = useState(30);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadSettings()
      .then((settings) => setDays(settings.historyDays))
      .catch((reason) => setError(errorText(reason)));
  }, []);

  async function save() {
    setBusy(true);
    setError("");
    try {
      const saved = await saveSettings(days);
      const choice = CHOICES.find((item) => item.days === saved.historyDays);
      onSaved(
        saved.historyDays === 0
          ? "History will be kept until you clear it."
          : `History older than ${choice?.label ?? `${saved.historyDays} days`} will be deleted.`,
      );
      onClose();
    } catch (reason) {
      setError(errorText(reason));
      setBusy(false);
    }
  }

  async function clear() {
    if (!window.confirm("Delete all saved queries, results, and logs?")) return;
    setBusy(true);
    setError("");
    try {
      await clearHistory();
      onSaved("History cleared.");
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overlay front" onMouseDown={onClose}>
      <div className="dialog small" onMouseDown={(event) => event.stopPropagation()}>
        <div className="dialog-title">Options</div>
        <div className="dialog-body">
          <div className="section-label">History</div>
          <div className="field">
            <label htmlFor="history-days">Delete history after</label>
            <select id="history-days" value={days} onChange={(event) => setDays(Number(event.target.value))}>
              {CHOICES.map((choice) => (
                <option key={choice.days} value={choice.days}>
                  {choice.label}
                </option>
              ))}
            </select>
          </div>
          <p className="settings-hint">
            Queries, cached results, and the application log older than this are removed. Passwords are never stored.
            Never keeps history until you clear it.
          </p>
        </div>
        {error ? <div className="dialog-error">{error}</div> : null}
        <div className="dialog-actions">
          <button type="button" disabled={busy} onClick={() => void clear()}>
            Clear history
          </button>
          <span className="spacer" />
          <button type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button className="default" type="button" disabled={busy} onClick={() => void save()}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
