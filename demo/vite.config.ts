import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  // The runtime package (file:../src/runtime) imports `three` bare; without dedupe its imports resolve
  // to a different three copy than the demo's `three/webgpu`, producing "Multiple instances of Three.js"
  // + broken TSL ("No stack defined"). Force a single three instance.
  resolve: {
    dedupe: ["three"],
    alias: {
      // Resolve the runtime to its SOURCE rather than the package `main` (dist/). The package entry only
      // updates when someone runs `npm run build` in ../src/runtime, so a plain `file:` link demos whatever
      // was last built — which is a poor way to try out a change you just made, and actively misleading when
      // dist has drifted from src. Pointing at source is what the editor app does too (see the root
      // vite.config.ts `@/runtime` alias), and it means `npm run dev` here always exercises the working tree.
      //
      // Drop this alias if you specifically want to validate the built artifact an npm consumer receives.
      "material-designer-runtime": fileURLToPath(new URL("../src/runtime/src/index.ts", import.meta.url)),
    },
  },
  optimizeDeps: {
    include: ["three", "three/webgpu", "three/tsl"],
  },
});
