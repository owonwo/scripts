import { readFileSync } from "node:fs";
import { defineConfig } from "vite-plus";
import { buildSync } from "esbuild";

const { version } = JSON.parse(readFileSync("./package.json", "utf-8"));

const workerCode = buildSync({
  entryPoints: ["src/worker.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  external: ["oxc-parser"],
  write: false,
}).outputFiles[0].text;

export default defineConfig({
  define: {
    __VERSION__: JSON.stringify(version),
    __WORKER_CODE__: JSON.stringify(workerCode),
  },
  build: {
    lib: {
      entry: {
        cli: "src/cli.ts",
        transformer: "src/transformer.ts",
      },
      formats: ["es"],
      fileName: (format, entryName) => `${entryName}.js`,
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
