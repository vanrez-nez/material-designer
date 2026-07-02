import React from "react";
import ReactDOM from "react-dom/client";

import { Layout } from "@/components/app/layout";
import type { MaterialAppServices } from "@/components/app/services";

export async function mountApp(services: MaterialAppServices): Promise<void> {
  const root = document.getElementById("root");
  if (!root) throw new Error("Missing #root element");
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <Layout services={services} />
    </React.StrictMode>,
  );
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}
