import { defineConfig } from "vite";

export default defineConfig({
  // The runtime package (file:../src/runtime) imports `three` bare; without dedupe its imports resolve
  // to a different three copy than the demo's `three/webgpu`, producing "Multiple instances of Three.js"
  // + broken TSL ("No stack defined"). Force a single three instance.
  resolve: {
    dedupe: ["three"],
  },
  optimizeDeps: {
    include: ["three", "three/webgpu", "three/tsl"],
  },
});
