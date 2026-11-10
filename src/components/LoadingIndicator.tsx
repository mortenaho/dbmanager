import { useSyncExternalStore, type ReactNode } from "react";
import { loadingStore } from "../loading";

export function LoadingIndicator({ fallback = null }: { fallback?: ReactNode }) {
  const loading = useSyncExternalStore(loadingStore.subscribe, loadingStore.getSnapshot);
  return loading ? (
    <span className="data-loading" role="status" aria-live="polite">
      <span className="data-loading-spinner" aria-hidden="true" />
      Loading data…
    </span>
  ) : fallback;
}
