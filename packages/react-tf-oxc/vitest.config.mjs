import { defineConfig } from "vitest/config";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { buildSync } from "esbuild";

const __dirname = dirname(fileURLToPath(import.meta.url));

const pkg = JSON.parse(
  readFileSync(resolve(__dirname, "package.json"), "utf-8"),
);

const workerCode = buildSync({
  entryPoints: [resolve(__dirname, "src/worker.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  external: ["oxc-parser"],
  write: false,
}).outputFiles[0].text;

export default defineConfig({
  define: {
    __VERSION__: JSON.stringify(pkg.version),
    __WORKER_CODE__: JSON.stringify(workerCode),
  },
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["dist/**/*", "node_modules/**/*"],
  },
});
