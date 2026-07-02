import { useState } from "react";

import { DocumentExportDialog } from "@/components/app/dialogs/DocumentExportDialog";
import { OpenDocumentDialog } from "@/components/app/dialogs/OpenDocumentDialog";
import { TextureExportDialog } from "@/components/app/dialogs/TextureExportDialog";
import { DocumentTitle } from "@/components/app/DocumentTitle";
import { useDocumentLibrarySync } from "@/components/app/useDocumentLibrarySync";
import { newDocument, openDocument } from "@/store/document-actions";
import { AppMenu } from "@/components/app/menu/AppMenu";
import { LayoutToolbar } from "@/editor/panes/common/LayoutToolbar";
import { WorkspaceLayout } from "@/editor/panes/common/WorkspaceLayout";
import { GraphPane } from "@/editor/panes/graph/GraphPane";
import { GraphPaneToolbar } from "@/editor/panes/graph/GraphPaneToolbar";
import { PreviewPane } from "@/editor/panes/preview/PreviewPane";
import { TexturePreviewPane } from "@/editor/panes/textures/TexturePreviewPane";
import { TexturePreviewPaneToolbar } from "@/editor/panes/textures/TexturePreviewPaneToolbar";
import type { MaterialAppServices } from "@/components/app/services";

export function Layout({ services }: { services: MaterialAppServices }) {
  const [isDocumentExportOpen, setIsDocumentExportOpen] = useState(false);
  const [isTextureExportOpen, setIsTextureExportOpen] = useState(false);
  const [isOpenDocumentOpen, setIsOpenDocumentOpen] = useState(false);

  useDocumentLibrarySync();

  return (
    <>
      <div className="workspace-shell">
        <header className="workspace-header">
          <AppMenu
            onExportDocument={() => setIsDocumentExportOpen(true)}
            onExportTextures={() => setIsTextureExportOpen(true)}
            onNewDocument={newDocument}
            onOpenDocument={() => setIsOpenDocumentOpen(true)}
          />
          <DocumentTitle onShowAll={() => setIsOpenDocumentOpen(true)} />
          <LayoutToolbar />
        </header>
        <main id="app" className="workspace-body">
          <WorkspaceLayout
            panes={{
              graph: <GraphPane />,
              scene: <PreviewPane />,
              "texture-preview": <TexturePreviewPane services={services} />,
            }}
            toolbars={{
              graph: <GraphPaneToolbar />,
              "texture-preview": <TexturePreviewPaneToolbar />,
            }}
          />
        </main>
      </div>
      <OpenDocumentDialog
        open={isOpenDocumentOpen}
        onOpen={openDocument}
        onOpenChange={setIsOpenDocumentOpen}
      />
      <DocumentExportDialog open={isDocumentExportOpen} onOpenChange={setIsDocumentExportOpen} />
      <TextureExportDialog
        open={isTextureExportOpen}
        services={services}
        onOpenChange={setIsTextureExportOpen}
      />
    </>
  );
}
