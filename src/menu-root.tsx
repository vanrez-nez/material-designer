import React from "react";
import ReactDOM from "react-dom/client";
import { AppMenu } from "@/components/app/menu/AppMenu";

export function mountAppMenu(): void {
  const root = document.getElementById("menu-root");
  if (!root) throw new Error("Missing #menu-root element");
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <AppMenu />
    </React.StrictMode>,
  );
}
