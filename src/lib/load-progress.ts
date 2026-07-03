// Shared load-progress state for the splash bar. Driven by the streaming preloader (src/lib/preload.ts)
// during the pre-React download phase — where it also updates the inline #splash-bar DOM directly — and
// read by the React SplashScreen via useSyncExternalStore after it takes over.
export type LoadProgress = { mode: "indeterminate" | "determinate"; value: number };

let snapshot: LoadProgress = { mode: "indeterminate", value: 0 };
const listeners = new Set<() => void>();

function emit(): void {
  // Drive the inline pre-React bar directly (it exists until React removes #splash on mount).
  const bar = document.getElementById("splash-bar");
  const fill = document.getElementById("splash-bar-fill");
  if (bar && fill) {
    if (snapshot.mode === "determinate") {
      bar.classList.remove("is-indeterminate");
      fill.style.width = `${snapshot.value}%`;
    } else {
      bar.classList.add("is-indeterminate");
    }
  }
  for (const listener of listeners) listener();
}

export function setLoadProgress(value: number): void {
  const clamped = Math.max(0, Math.min(100, value));
  snapshot = { mode: "determinate", value: clamped };
  emit();
}

export function setIndeterminate(): void {
  snapshot = { mode: "indeterminate", value: 0 };
  emit();
}

export function getLoadProgress(): LoadProgress {
  return snapshot;
}

export function subscribeLoadProgress(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
