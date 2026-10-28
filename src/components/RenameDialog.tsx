import { useState } from "react";
import { errorText } from "../types";

export function RenameDialog(props: {
  title: string;
  label: string;
  current: string;
  onCancel: () => void;
  onSubmit: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(props.current);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    const next = name.trim();
    if (!next) {
      setError("Name is required.");
      return;
    }
    if (next === props.current) {
      props.onCancel();
      return;
    }
    setBusy(true);
    setError("");
    try {
      await props.onSubmit(next);
    } catch (reason) {
      setError(errorText(reason));
      setBusy(false);
    }
  }

  return (
    <div className="overlay" onMouseDown={props.onCancel}>
      <form
        className="dialog small"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="dialog-title">{props.title}</div>
        <div className="dialog-body">
          <div className="field">
            <label htmlFor="rename-name">{props.label}</label>
            <input
              id="rename-name"
              autoFocus
              value={name}
              disabled={busy}
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
        </div>
        {error ? <div className="dialog-error">{error}</div> : null}
        <div className="dialog-actions">
          <button type="submit" className="default" disabled={busy}>
            OK
          </button>
          <button type="button" onClick={props.onCancel} disabled={busy}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
