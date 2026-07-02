import React from "react";
import ReactDOM from "react-dom/client";
import { Layout } from "@/components/app/layout";

export async function mountAppMenu(): Promise<void> {
  const root = document.getElementById("root");
  if (!root) throw new Error("Missing #root element");
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <Layout />
    </React.StrictMode>,
  );
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}
