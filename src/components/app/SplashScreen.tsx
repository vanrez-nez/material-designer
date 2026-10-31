import { useCallback, useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from "react";
import { X } from "lucide-react";

import { Button, Checkbox, EmptyState, Time } from "@tweakpad/ui/react";

import { GithubMark } from "@/components/app/GithubMark";
import type { MaterialAppServices } from "@/components/app/services";
import { REPO_URL } from "@/lib/constants";
import { getLoadProgress, subscribeLoadProgress } from "@/lib/load-progress";
import { splashHidden, setSplashHidden } from "@/lib/splash-prefs";
import { cn } from "@/lib/utils";
import { openDocument } from "@/store/document-actions";
import { listDocuments, useDocumentLibraryStore } from "@/store/document-library";

const RECENT_COUNT = 5;
const MIN_VISIBLE_MS = 1000; // Floor: never reveal the panel sooner than this, even if boot is instant.
const SAFETY_MS = 8000; // Reveal anyway if the WebGPU-ready signal never arrives.
const CLOSE_MS = 260; // Matches the fade-out transition before unmount.

function truncateTitle(title: string): string {
  return title.length > 25 ? `${title.slice(0, 24)}…` : title;
}

// Launcher splash: full-bleed image while the app boots, then eases into a 60/40 split with a recent-files
// launcher panel. The instant first paint lives in index.html; this React overlay takes over seamlessly.
export function SplashScreen({
  services,
  onOpenCatalog,
  onDismiss,
}: {
  services: MaterialAppServices;
  onOpenCatalog: () => void;
  onDismiss: () => void;
}) {
  const imgUrl = window.__SPLASH_IMG__ ?? `${import.meta.env.BASE_URL}assets/splash_1.jpg`;

  const ready = useSyncExternalStore(
    useCallback((cb) => services.subscribe(cb), [services]),
    useCallback(() => services.getSnapshot().textureReady, [services]),
  );
  const progress = useSyncExternalStore(subscribeLoadProgress, getLoadProgress);
  const [minElapsed, setMinElapsed] = useState(false);
  const [safety, setSafety] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [closing, setClosing] = useState(false);

  const documents = useDocumentLibraryStore((state) => state.documents);
  const recent = useMemo(() => listDocuments(documents).slice(0, RECENT_COUNT), [documents]);
  const [dontShow, setDontShow] = useState(splashHidden);

  const shouldExpand = (ready || safety) && minElapsed;

  // Kick off the reveal on a main-thread idle gap, not the instant boot signals it — otherwise the
  // transition competes with the tail of boot work (PMREM/IBL, first frames) and janks. requestIdleCallback
  // waits for a free frame; the timeout guarantees it still fires under sustained load.
  useEffect(() => {
    if (!shouldExpand || expanded) return;
    // requestIdleCallback isn't universal (Safari <16.4, some webviews) — a missing one threw here and
    // aborted the splash/boot. Fall back to a short timer when it's absent.
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(() => setExpanded(true), { timeout: 800 });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(() => setExpanded(true), 200);
    return () => window.clearTimeout(id);
  }, [shouldExpand, expanded]);

  // Take over from the inline pre-JS splash once React has painted (idempotent under StrictMode).
  useLayoutEffect(() => {
    document.getElementById("splash")?.remove();
  }, []);

  useEffect(() => {
    const min = window.setTimeout(() => setMinElapsed(true), MIN_VISIBLE_MS);
    const safe = window.setTimeout(() => setSafety(true), SAFETY_MS);
    return () => {
      window.clearTimeout(min);
      window.clearTimeout(safe);
    };
  }, []);

  const close = useCallback(() => {
    setClosing(true);
    window.setTimeout(onDismiss, CLOSE_MS);
  }, [onDismiss]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  const handleDontShow = (checked: boolean): void => {
    setDontShow(checked);
    setSplashHidden(checked);
  };

  return (
    <div
      className={cn("splash", expanded && "splash--expanded", closing && "splash--closing")}
      onClick={close}
    >
      <div className="splash__dialog">
        <div className="splash__image" style={{ backgroundImage: `url('${imgUrl}')` }} />
        <div className="splash__panel" onClick={(event) => event.stopPropagation()}>
        <Button aria-label="Close" className="splash__close" size="icon-sm" variant="ghost" onClick={close}>
          <X slot="icon-start" />
        </Button>

        <div className="splash__brand">
          Material Designer
          <span className="splash__version">v{__APP_VERSION__}</span>
        </div>

        <div className="splash__actions">
          <Button variant="secondary" onClick={onOpenCatalog}>
            Open the catalog
          </Button>
          <Button href={REPO_URL} rel="noreferrer" target="_blank" variant="ghost">
            Help
          </Button>
          <Button href={REPO_URL} rel="noreferrer" target="_blank" variant="ghost">
            <GithubMark slot="icon-start" />
            GitHub Repository
          </Button>
        </div>

        <div className="splash__recent">
          <div className="splash__recent-title">Recent files</div>
          {recent.length === 0 ? (
            <EmptyState title="No recent files yet" />
          ) : (
            recent.map((entry) => (
              <Button
                key={entry.id}
                className="splash__recent-item"
                variant="ghost"
                onClick={() => {
                  openDocument(entry.id);
                  close();
                }}
              >
                <span className="splash__recent-name">{truncateTitle(entry.title)}</span>
                <Time
                  className="splash__recent-time"
                  datetime={entry.updatedAt}
                  mode="relative"
                  numeric="always"
                  relativeStyle="narrow"
                  tooltip={false}
                />
              </Button>
            ))
          )}
        </div>

        <Checkbox
          className="splash__dontshow"
          checked={dontShow}
          onCheckedChange={(event) => handleDontShow(event.detail.value)}
        >
          Do not show this screen again
        </Checkbox>
        </div>
        <div
          className={cn(
            "splash__bar",
            progress.mode === "indeterminate" && "splash__bar--indeterminate",
          )}
        >
          <div
            className="splash__bar-fill"
            style={progress.mode === "determinate" ? { width: `${progress.value}%` } : undefined}
          />
        </div>
      </div>
    </div>
  );
}
