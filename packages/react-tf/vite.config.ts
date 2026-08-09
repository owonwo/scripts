import { defineConfig } from "vite-plus";

export default defineConfig({
  build: {
    lib: {
      entry: "src/cli.ts",
      formats: ["es"],
      fileName: "cli",
    },
    outDir: "dist",
    target: "node22",
    rollupOptions: {
      external: [
        "ts-morph",
        "effect",
        "@effect/cli",
        "@effect/platform",
        "@effect/platform-node",
        "fast-fs-hash",
        "node:worker_threads",
        "node:path",
        "node:url",
        "node:fs",
        "node:crypto",
      ],
    },
  },
});
