import { readFileSync } from "node:fs";

const raw = readFileSync(process.argv[2], "utf-8");
// Strip biome's experimental warning lines that precede JSON
const jsonStart = raw.indexOf("{");
const output = JSON.parse(raw.slice(jsonStart));

// Only check plugin diagnostics (not biome built-in lints)
const pluginDiags = (output.diagnostics || []).filter(
  (d) => d.category === "plugin"
);

const expected = {
  "src/arrow-component.tsx": {
    "Arrow function component should be a function declaration.": [6],
  },
  "src/destructured-props.tsx": {
    "Rest parameter should be named `restProps` to avoid confusion with destructured props.": [8, 18],
  },
  "src/inline-type.tsx": {
    "Inline type literal should be extracted to a named type alias.": [9, 15],
  },
  "src/rest-props.tsx": {
    "Rest parameter should be named `restProps` to avoid confusion with destructured props.": [8],
  },
};

let failed = false;

for (const [file, rules] of Object.entries(expected)) {
  for (const [message, lines] of Object.entries(rules)) {
    const diags = pluginDiags.filter(
      (d) => d.location?.path === file && d.message === message
    );

    for (const line of lines) {
      const found = diags.some((d) => d.location?.start?.line === line);
      if (!found) {
        console.error(`✗ ${file}:${line} — expected "${message}"`);
        failed = true;
      } else {
        console.log(`✓ ${file}:${line} — "${message}"`);
      }
    }

    // Check no unexpected lines
    const foundLines = diags.map((d) => d.location?.start?.line);
    const unexpected = foundLines.filter((l) => !lines.includes(l));
    for (const line of unexpected) {
      console.error(`✗ ${file}:${line} — unexpected "${message}"`);
      failed = true;
    }
  }
}

process.exit(failed ? 1 : 0);
