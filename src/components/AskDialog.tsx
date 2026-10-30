import { useState } from "react";
import { errorText } from "../types";

type Props = {
  target: string;
  onClose: () => void;
  onAsk: (question: string) => Promise<void>;
};

export function AskDialog({ target, onClose, onAsk }: Props) {
  const [question, setQuestion] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    const text = question.trim();
    if (!text) {
      setError("Type a question first.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onAsk(text);
      onClose();
    } catch (reason) {
      setError(errorText(reason));
      setBusy(false);
    }
  }

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog ask" onMouseDown={(event) => event.stopPropagation()}>
        <div className="dialog-title">Ask</div>
        <div className="dialog-body">
          <p className="ask-lead">
            {target
              ? `Draft a query for ${target}. It opens in a new tab. Press F5 when you want to run it.`
              : "Connect to a database first. Ask uses that connection's tables and columns."}
          </p>
          <label className="ask-label" htmlFor="ask-question">
            Question
          </label>
          <textarea
            id="ask-question"
            className="ask-question"
            value={question}
            disabled={!target || busy}
            placeholder="Customers in Babol and how many orders each has"
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                void submit();
              }
            }}
          />
          <p className="settings-hint ask-hint">
            Table and column names are sent to the assistant in Tools → Options. Row data and passwords stay here.
          </p>
        </div>
        {error ? <div className="dialog-error">{error}</div> : null}
        <div className="dialog-actions">
          <span className="spacer" />
          <button type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button className="default" type="button" disabled={!target || busy} onClick={() => void submit()}>
            {busy ? "Drafting..." : "Draft SQL"}
          </button>
        </div>
      </div>
    </div>
  );
}
