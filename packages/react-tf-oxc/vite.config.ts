import { readFileSync } from "node:fs";
import { defineConfig } from "vite-plus";

const { version } = JSON.parse(readFileSync("./package.json", "utf-8"));

export default defineConfig({
  define: {
    __VERSION__: JSON.stringify(version),
  },
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
        "oxc-parser",
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
