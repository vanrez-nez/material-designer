// Persisted "don't show the splash again" flag. Uses the raw localStorage "1"/"0" convention shared with
// the inline pre-JS splash script in index.html — keep SPLASH_HIDDEN_KEY in sync with that script.
export const SPLASH_HIDDEN_KEY = "material-designer-splash-hidden";

export function splashHidden(): boolean {
  try {
    return localStorage.getItem(SPLASH_HIDDEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function setSplashHidden(hidden: boolean): void {
  try {
    localStorage.setItem(SPLASH_HIDDEN_KEY, hidden ? "1" : "0");
  } catch {
    // Ignore storage failures (private mode, quota) — the splash simply shows next time.
  }
}
