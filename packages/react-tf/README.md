---
title: "React Component Transformer"
description: "A CLI tool that transforms React function components from arrow functions to function declarations with type extraction."
---

# React Component Transformer

A CLI tool that transforms React function components from arrow functions to function declarations, with type extraction for inline props.

## Features

- **Arrow Function → Function Declaration**: Automatically converts arrow function components to function declarations
- **Inline Type Extraction**: Extracts inline type literals to named type aliases (e.g., `{ name: string }` → `ComponentProps`)
- **Named Type Destructuring**: Moves destructuring to function body for components with ≥3 props or default values
- **Rest Element Handling**: Renames `...props` to `...restProps` to avoid naming conflicts
- **Gitignore-Aware Filtering**: Respects `.gitignore` files when scanning for files
- **Content-Hash Caching**: Skips unchanged files for faster re-runs
- **Parallel Processing**: Uses worker threads for multi-core performance
- **Debug Mode**: Real-time logging with color-coded timing

## Usage

```bash
# Basic usage
react-component-transformer ./src

# With debug logging
react-component-transformer ./src --debug

# Force reprocess (ignore cache)
react-component-transformer ./src --force

# Specify number of workers
react-component-transformer ./src --workers 8
```

## Options

| Option        | Alias | Description                      | Default |
| ------------- | ----- | -------------------------------- | ------- |
| `--directory` | -     | Directory to scan for .tsx files | `.`     |
| `--debug`     | `-d`  | Enable debug logging             | `false` |
| `--workers`   | `-w`  | Number of worker threads         | `4`     |
| `--force`     | `-f`  | Force reprocess (ignore cache)   | `false` |

## Transformations

### Arrow Function with Inline Type

**Before:**

```tsx
const Box = ({ boxes, count }: { boxes: number; count: string }) => {
  return (
    <div>
      {boxes} - {count}
    </div>
  );
};
```

**After:**

```tsx
type BoxProps = {
  boxes: number;
  count: string;
};

function Box(props: BoxProps) {
  const { boxes, count } = props;

  return (
    <div>
      {boxes} - {count}
    </div>
  );
}
```

### Function Declaration with Named Type (≥3 Props)

**Before:**

```tsx
function Avatar({ size = 80, disabled, className, ...props }: AvatarProps) {
  return <div {...props} className={className} />;
}
```

**After:**

```tsx
function Avatar(props: AvatarProps) {
  const { size = 80, disabled, className, ...restProps } = props;

  return <div {...restProps} className={className} />;
}
```

## How It Works

1. **Scanning**: Recursively scans the target directory for `.tsx` files, respecting `.gitignore` rules
2. **Caching**: Checks content-hash cache to skip unchanged files
3. **Parallel Processing**: Distributes files across worker threads
4. **AST Transformation**: Uses `ts-morph` to parse and transform the AST
5. **Output**: Writes transformed files back to disk

## Cache

The tool maintains a `.transformer-cache.json` file in the target directory that stores content hashes of processed files. This allows it to skip files that haven't changed since the last run.

To force reprocessing of all files, use the `--force` flag.

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Build the CLI
npm run build

# Run demo
npm run demo
```

## License

MIT
