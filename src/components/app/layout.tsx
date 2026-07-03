import { useState } from "react";

import { DocumentExportDialog } from "@/components/app/dialogs/DocumentExportDialog";
import { FromCatalogDialog } from "@/components/app/dialogs/FromCatalogDialog";
import { OpenDocumentDialog } from "@/components/app/dialogs/OpenDocumentDialog";
import { TextureExportDialog } from "@/components/app/dialogs/TextureExportDialog";
import { DocumentTitle } from "@/components/app/DocumentTitle";
import { StatusBar } from "@/components/app/StatusBar";
import { useDocumentLibrarySync } from "@/components/app/useDocumentLibrarySync";
import { newDocument, openCatalogMaterial, openDocument } from "@/store/document-actions";
import { makePreset } from "@/presets";
import { AppMenu } from "@/components/app/menu/AppMenu";
import { LayoutToolbar } from "@/editor/panes/common/LayoutToolbar";
import { WorkspaceLayout } from "@/editor/panes/common/WorkspaceLayout";
import { GraphPane } from "@/editor/panes/graph/GraphPane";
import { GraphPaneTitle } from "@/editor/panes/graph/GraphPaneTitle";
import { GraphPaneToolbar } from "@/editor/panes/graph/GraphPaneToolbar";
import { PreviewPane } from "@/editor/panes/preview/PreviewPane";
import { TexturePreviewPane } from "@/editor/panes/textures/TexturePreviewPane";
import { TexturePreviewPaneToolbar } from "@/editor/panes/textures/TexturePreviewPaneToolbar";
import type { MaterialAppServices } from "@/components/app/services";

export function Layout({ services }: { services: MaterialAppServices }) {
  const [isDocumentExportOpen, setIsDocumentExportOpen] = useState(false);
  const [isTextureExportOpen, setIsTextureExportOpen] = useState(false);
  const [isOpenDocumentOpen, setIsOpenDocumentOpen] = useState(false);
  const [isFromCatalogOpen, setIsFromCatalogOpen] = useState(false);

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
            onOpenCatalog={() => setIsFromCatalogOpen(true)}
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
            titles={{
              graph: <GraphPaneTitle />,
            }}
            toolbars={{
              graph: <GraphPaneToolbar />,
              "texture-preview": <TexturePreviewPaneToolbar />,
            }}
          />
        </main>
        <StatusBar />
      </div>
      <OpenDocumentDialog
        open={isOpenDocumentOpen}
        onOpen={openDocument}
        onOpenChange={setIsOpenDocumentOpen}
      />
      <FromCatalogDialog
        open={isFromCatalogOpen}
        onOpen={(material) => openCatalogMaterial(makePreset(material.preset), material.name)}
        onOpenChange={setIsFromCatalogOpen}
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
