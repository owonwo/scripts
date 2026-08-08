# React Component Transformer — Biome Lint Rules

GritQL lint rules for the [React Component Transformer](../react-tf) coding standards. Detects transformable patterns and provides auto-fixes where safe.

Pairs with [`@wigxel/react-tf`](../react-tf) — this package provides lint-time warnings, the CLI performs the actual refactoring.

## Rules

| Rule | What it detects | Severity | Auto-fix |
| --- | --- | --- | --- |
| `arrow-component.grit` | Arrow function components (`const Foo = () => ...`) | hint | — |
| `inline-type-literal.grit` | Inline type literals in params (`({ x }: { x: string })`) | warn | — |
| `rest-props-rename.grit` | `...props` naming conflict | warn | `...props` → `...restProps` |
| `destructured-props-complex.grit` | 3+ destructured props | hint | — |

## Setup

### Install

```bash
pnpm add -D @biomejs/biome @wigxel/react-tf-biome
```

### Setup

Run the setup command to automatically add plugins to your `biome.json`:

```bash
npx react-tf-biome
```

This will:
- Find your `biome.json` (or `biome.jsonc`)
- Add the 4 plugin paths if not already configured
- Create `biome.json` if it doesn't exist

#### Options

```bash
# Preview changes without writing
npx react-tf-biome --dry-run
```

### Manual Configuration

If you prefer to configure manually, add the plugin paths to your `biome.json`:

```json
{
  "plugins": [
    "./node_modules/@wigxel/react-tf-biome/plugins/arrow-component.grit",
    "./node_modules/@wigxel/react-tf-biome/plugins/destructured-props-complex.grit",
    "./node_modules/@wigxel/react-tf-biome/plugins/inline-type-literal.grit",
    "./node_modules/@wigxel/react-tf-biome/plugins/rest-props-rename.grit"
  ]
}
```

#### Monorepo (nested biome.json)

If your `biome.json` is in a subdirectory (e.g., `packages/app/biome.json`), adjust the path to reach `node_modules`:

```json
{
  "plugins": [
    "../../node_modules/@wigxel/react-tf-biome/plugins/arrow-component.grit",
    "../../node_modules/@wigxel/react-tf-biome/plugins/destructured-props-complex.grit",
    "../../node_modules/@wigxel/react-tf-biome/plugins/inline-type-literal.grit",
    "../../node_modules/@wigxel/react-tf-biome/plugins/rest-props-rename.grit"
  ]
}
```

#### Restrict to specific paths

Override the plugin `includes` in your own config:

```json
{
  "plugins": [
    {
      "path": "./node_modules/@wigxel/react-tf-biome/plugins/arrow-component.grit",
      "includes": ["src/components/**/*.tsx"]
    },
    "./node_modules/@wigxel/react-tf-biome/plugins/destructured-props-complex.grit",
    "./node_modules/@wigxel/react-tf-biome/plugins/inline-type-literal.grit",
    "./node_modules/@wigxel/react-tf-biome/plugins/rest-props-rename.grit"
  ]
}
```

## Usage

```bash
# Lint and show warnings
biome lint ./src

# Lint and auto-fix safe issues (...props rename)
biome lint --write ./src
```

## How it works

These rules run as part of `biome lint`. They detect patterns that [`@wigxel/react-tf`](../react-tf) can transform, giving you feedback before running the CLI.

```bash
# Step 1: See what needs transforming
biome lint ./src

# Step 2: Run the actual refactoring
pnpm add -D @wigxel/react-tf
wigxel-rtf ./src
```

## Dependencies

- `@biomejs/biome >=2.0.0` (peer, optional)
