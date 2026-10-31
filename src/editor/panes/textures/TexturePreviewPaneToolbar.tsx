import { RotateCcw } from "lucide-react";
import { Button, Switch } from "@tweakpad/ui/react";

import { useTexturePreviewStore } from "@/editor/panes/textures/store";

export function TexturePreviewPaneToolbar() {
  const seams = useTexturePreviewStore((state) => state.seams);
  const setSeams = useTexturePreviewStore((state) => state.setSeams);
  const setZoom = useTexturePreviewStore((state) => state.setZoom);

  return (
    <div className="workspace-pane__toolbar-group" aria-label="Texture preview controls">
      <Button
        aria-label="Reset texture preview zoom"
        size="icon"
        title="Reset zoom"
        variant="ghost"
        onClick={() => setZoom(1)}
      >
        <RotateCcw slot="icon-start" />
      </Button>
      <Switch checked={seams} size="sm" onCheckedChange={(event) => setSeams(event.detail.value)}>
        Seams
      </Switch>
    </div>
  );
}
