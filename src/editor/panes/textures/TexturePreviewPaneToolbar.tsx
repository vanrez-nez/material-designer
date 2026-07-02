import { RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/primitives/button";
import { Switch } from "@/components/ui/primitives/switch";
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
        type="button"
        variant="ghost"
        onClick={() => setZoom(1)}
      >
        <RotateCcw className="size-3.5" />
      </Button>
      <label className="workspace-pane__switch">
        <Switch checked={seams} size="sm" onCheckedChange={setSeams} />
        <span>Seams</span>
      </label>
    </div>
  );
}
