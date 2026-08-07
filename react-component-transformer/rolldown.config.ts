import { defineConfig } from "rolldown";

export default defineConfig({
  input: "src/cli.ts",
  output: {
    file: "dist/cli.mjs",
    format: "esm",
  },
  platform: "node",
  target: "node22",
  external: [
    "ts-morph",
    "effect",
    "@effect/cli",
    "@effect/platform",
    "@effect/platform-node",
    "@effect/schema",
    "fast-fs-hash",
    "node:worker_threads",
    "node:path",
    "node:url",
    "node:fs",
    "node:crypto",
  ],
});
