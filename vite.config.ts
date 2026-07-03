import { statSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

import appPkg from "./package.json" with { type: "json" };
import runtimePkg from "./src/runtime/package.json" with { type: "json" };

// Emit load-manifest.json — the app's JS/CSS chunks plus the eager splash images, with their UNCOMPRESSED
// byte sizes. The splash preloader (src/lib/preload.ts) streams these to drive a real 0–100% bar;
// uncompressed sizes make decompressed stream bytes match the total even when the host gzips. Everything
// reachable at runtime is included (boot statically imports the bake-setup module, so it downloads on the
// normal route too); only sourcemaps are skipped.
function loadManifestPlugin(): Plugin {
  return {
    name: "load-manifest",
    apply: "build",
    generateBundle(_options, bundle) {
      const entries: { url: string; bytes: number }[] = [];
      for (const [fileName, output] of Object.entries(bundle)) {
        if (output.type === "chunk") {
          entries.push({ url: fileName, bytes: Buffer.byteLength(output.code) });
        } else if (fileName.endsWith(".css")) {
          const source = output.source;
          entries.push({
            url: fileName,
            bytes: typeof source === "string" ? Buffer.byteLength(source) : source.byteLength,
          });
        }
      }
      for (const name of ["splash_1.jpg", "splash_2.jpg"]) {
        const path = fileURLToPath(new URL(`./public/assets/${name}`, import.meta.url));
        entries.push({ url: `assets/${name}`, bytes: statSync(path).size });
      }
      this.emitFile({
        type: "asset",
        fileName: "load-manifest.json",
        source: JSON.stringify(entries),
      });
    },
  };
}

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
  plugins: [react(), tailwindcss(), loadManifestPlugin()],
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
