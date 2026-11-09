import { invoke as tauriInvoke } from "@tauri-apps/api/core";

let pending = 0;
const listeners = new Set<() => void>();

export const loadingStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  getSnapshot: () => pending > 0,
};

function update(delta: number) {
  pending += delta;
  listeners.forEach((listener) => listener());
}

export const invoke: typeof tauriInvoke = async (command, args, options) => {
  // Logging and cancellation should not keep the data loading indicator active.
  const tracked = command !== "log_event" && command !== "cancel_sql";
  if (tracked) update(1);
  try {
    return await tauriInvoke(command, args, options);
  } finally {
    if (tracked) update(-1);
  }
};
