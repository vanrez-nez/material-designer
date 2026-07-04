// Wipes ALL locally persisted app data (workspace store, document library, graph-doc copies,
// renderer config, splash flag, widget prefs) from both storages, then reloads to a clean boot.
// This is the deliberate fix for stale-cache states; a partial clear is what caused them. The origin
// holds only this app's data, so a full wipe is safe and also catches future persistKey states.
export function clearSession(): void {
  try {
    localStorage.clear();
    sessionStorage.clear();
  } finally {
    window.location.reload();
  }
}
