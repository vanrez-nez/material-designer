import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

import appPkg from "./package.json" with { type: "json" };
import runtimePkg from "./src/runtime/package.json" with { type: "json" };

const threeRoot = fileURLToPath(new URL("./node_modules/three", import.meta.url));
const threeModule = fileURLToPath(new URL("./node_modules/three/build/three.module.js", import.meta.url));
const threeWebgpu = fileURLToPath(new URL("./node_modules/three/build/three.webgpu.js", import.meta.url));
const threeTsl = fileURLToPath(new URL("./node_modules/three/build/three.tsl.js", import.meta.url));
const threeExamples = fileURLToPath(new URL("./node_modules/three/examples/jsm", import.meta.url));

export default defineConfig({
  // Relative base so the build works whether GitHub Pages serves it at a domain root or a project
  // subpath (…/material-designer/). All asset URLs become relative to index.html; runtime asset paths
  // use import.meta.env.BASE_URL.
  base: "./",
  define: {
    __APP_VERSION__: JSON.stringify(appPkg.version),
    __RUNTIME_VERSION__: JSON.stringify(runtimePkg.version),
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: "@/runtime", replacement: fileURLToPath(new URL("./src/runtime/src/index.ts", import.meta.url)) },
      { find: "@/runtime/", replacement: fileURLToPath(new URL("./src/runtime/src/", import.meta.url)) },
      { find: "three/webgpu", replacement: threeWebgpu },
      { find: "three/tsl", replacement: threeTsl },
      { find: /^three\/examples\/jsm\/(.*)$/, replacement: `${threeExamples}/$1` },
      { find: /^three\/addons\/(.*)$/, replacement: `${threeExamples}/$1` },
      { find: /^three\/src\/(.*)$/, replacement: `${threeRoot}/src/$1` },
      { find: "three", replacement: threeModule },
      { find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) },
    ],
    dedupe: ["three"],
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
