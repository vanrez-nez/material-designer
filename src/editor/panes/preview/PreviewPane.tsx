import { useLayoutEffect, useRef } from "react";

import { dispatchMaterialPreviewPaneMount } from "@/app-events";

export function PreviewPane() {
  const sceneHostRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (sceneHostRef.current) {
      dispatchMaterialPreviewPaneMount(sceneHostRef.current);
    }
  }, []);

  return (
    <div className="preview-host">
      <div ref={sceneHostRef} className="scene-host" />
    </div>
  );
}
