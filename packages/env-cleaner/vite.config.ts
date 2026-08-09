import { readFileSync } from "node:fs";
import { defineConfig } from "vite-plus";

const { version } = JSON.parse(readFileSync("./package.json", "utf-8"));

export default defineConfig({
  define: {
    __VERSION__: JSON.stringify(version),
  },
  build: {
    lib: {
      entry: "src/index.ts",
      formats: ["es"],
      fileName: "index",
    },
    outDir: ".build",
    target: "node22",
    rollupOptions: {
      external: [
        "effect",
        "@effect/cli",
        "@effect/platform-node",
        "node:fs",
        "node:path",
        "node:url",
      ],
    },
  },
});
