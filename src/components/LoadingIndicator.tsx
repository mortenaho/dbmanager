import { useSyncExternalStore } from "react";
import { loadingStore } from "../loading";

export function LoadingIndicator() {
  const loading = useSyncExternalStore(loadingStore.subscribe, loadingStore.getSnapshot);
  return loading ? (
    <div className="data-loading" role="status" aria-live="polite">
      <span className="data-loading-spinner" aria-hidden="true" />
      Loading data…
    </div>
  ) : null;
}
