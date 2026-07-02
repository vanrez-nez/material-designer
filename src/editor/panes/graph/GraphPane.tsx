import { useLayoutEffect, useRef } from "react";

import { dispatchMaterialGraphPaneMount } from "@/app-events";

export function GraphPane() {
  const graphHostRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (graphHostRef.current) dispatchMaterialGraphPaneMount(graphHostRef.current);
  }, []);

  return <div ref={graphHostRef} className="graph-host" />;
}
