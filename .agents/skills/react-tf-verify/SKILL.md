---
name: react-tf-verify
description: Verify react-tf CLI transformations after code changes
---

# Verify React-TF Transformations

After any change to `cli.ts` or `transformer.ts`, run this verification sequence.

## Beads Memory

Reference these persisted memories (via `bd remember`):

- **sample-testing-method**: After building react-tf, test CLI output by restoring
  sample files via git, running `node dist/cli.js ./sample/src/<file>`, and checking output.
- **sample-testing-always-use-force-flag**: ALWAYS use `--force` flag. No need for
  cache clearing.

## Rules

- **NEVER write to sample files directly.** The sample files are test fixtures. Run the CLI to transform them, then inspect the output. If the output is wrong, fix the implementation, not the sample.

## Verification Workflow

### 1. Build
```bash
cd packages/react-tf && npx vite build
```

### 2. Run unit tests
```bash
cd packages/react-tf && npx vitest run
```

### 3. Restore sample files (CLI overwrites them)
```bash
cd packages/react-tf
git checkout -- sample/src/
```

### 4. Test every .tsx file in the sample folder
```bash
cd packages/react-tf
for f in $(find sample/src -name '*.tsx'); do
  echo "--- $f ---"
  node dist/cli.js --force "$f"
  echo ""
done
```

Then inspect each file with `cat` to verify the output looks correct.

### 5. Expected output checks

- `export default` at bottom, not inline
- Arrow functions → `function` declarations (with `async` if original was async)
- Inline type props → `export type XProps = { ... };` above function
- Destructured props → `const { ... } = props;` in function body
- Function order matches original source
- JSDoc comments between type alias and function definition (type → comment → function)
