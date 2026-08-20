import { defineConfig } from "vitest/config";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const pkg = JSON.parse(
  readFileSync(resolve(__dirname, "package.json"), "utf-8"),
);

export default defineConfig({
  define: {
    __VERSION__: JSON.stringify(pkg.version),
  },
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["dist/**/*", "node_modules/**/*"],
  },
});
