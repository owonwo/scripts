import { readFileSync } from "node:fs";

const raw = readFileSync(process.argv[2], "utf-8");
const jsonStart = raw.indexOf("{");
const output = JSON.parse(raw.slice(jsonStart));

const pluginDiags = (output.diagnostics || []).filter(
  (d) => d.category === "plugin",
);

// File-level validation: each rule fires on expected files, not others
const rules = {
  "Arrow function component should be a function declaration.": {
    shouldFire: ["src/arrow-component.tsx"],
    shouldNotFire: ["src/destructured-props.tsx", "src/inline-type.tsx", "src/rest-props.tsx"],
  },
  "Rest parameter should be named `restProps` to avoid confusion with destructured props.": {
    shouldFire: ["src/destructured-props.tsx", "src/rest-props.tsx"],
    shouldNotFire: ["src/arrow-component.tsx", "src/inline-type.tsx"],
  },
  "Inline type literal should be extracted to a named type alias.": {
    shouldFire: ["src/inline-type.tsx"],
    shouldNotFire: ["src/arrow-component.tsx"],
  },
};

let failed = false;

for (const [message, { shouldFire, shouldNotFire }] of Object.entries(rules)) {
  const diags = pluginDiags.filter((d) => d.message === message);
  const firedFiles = [...new Set(diags.map((d) => d.location?.path))];

  for (const file of shouldFire) {
    if (!firedFiles.includes(file)) {
      console.error(`✗ ${file} — expected "${message}" to fire`);
      failed = true;
    } else {
      console.log(`✓ ${file} — "${message}"`);
    }
  }

  for (const file of shouldNotFire) {
    if (firedFiles.includes(file)) {
      console.error(`✗ ${file} — "${message}" should NOT fire`);
      failed = true;
    }
  }
}

process.exit(failed ? 1 : 0);
