import { useLayoutEffect, useRef } from "react";

import { dispatchMaterialPreviewPaneMount } from "@/app-events";

export function PreviewPane() {
  const sceneHostRef = useRef<HTMLDivElement | null>(null);
  const paneHostRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (sceneHostRef.current && paneHostRef.current) {
      dispatchMaterialPreviewPaneMount(sceneHostRef.current, paneHostRef.current);
    }
  }, []);

  return (
    <div className="preview-host">
      <div ref={sceneHostRef} className="scene-host" />
      <div ref={paneHostRef} className="pane-host" />
    </div>
  );
}
