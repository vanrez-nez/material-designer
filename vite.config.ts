import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: "@/runtime", replacement: fileURLToPath(new URL("./src/runtime/src/index.ts", import.meta.url)) },
      { find: "@/runtime/", replacement: fileURLToPath(new URL("./src/runtime/src/", import.meta.url)) },
      { find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) },
    ],
  },
  optimizeDeps: {
    entries: ["index.html"],
  },
  server: {
    watch: {
      ignored: ["**/external/**"],
    },
  },
});
