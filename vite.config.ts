import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    alias: {
      "@/runtime": fileURLToPath(new URL("./src/runtime/src/index.ts", import.meta.url)),
      "@/runtime/": fileURLToPath(new URL("./src/runtime/src/", import.meta.url)),
    },
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
