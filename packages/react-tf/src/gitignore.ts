import ignore, { Ignore } from "ignore";
import * as fs from "node:fs";
import * as path from "node:path";

// Default patterns that are always ignored (common build/cache directories)
const DEFAULT_IGNORED = [
  "node_modules",
  ".git",
  "dist",
  ".next",
  "build",
  ".cache",
  ".turbo",
  ".vercel",
  ".netlify",
  "coverage",
  ".nyc_output",
  "__pycache__",
  ".DS_Store",
];

// Directories to skip during gitignore file discovery — avoids traversing
// into thousands of irrelevant subdirectories (e.g. node_modules, .git)
export const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".cache",
  ".turbo",
  ".vercel",
  ".netlify",
  "coverage",
  ".nyc_output",
  "__pycache__",
]);

export function createGitignoreFilter(targetDir: string): (filePath: string) => boolean {
  const ig = ignore();

  // Add default ignored patterns
  ig.add(DEFAULT_IGNORED);

  // Find and parse .gitignore files recursively
  const gitignoreFiles = findGitignoreFiles(targetDir);

  for (const gitignorePath of gitignoreFiles) {
    const relativeDir = path.dirname(path.relative(targetDir, gitignorePath));
    const content = fs.readFileSync(gitignorePath, "utf-8");
    const lines = content.split("\n");

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      // If the gitignore is in a subdirectory, prefix the pattern
      if (relativeDir !== ".") {
        // For subdirectory gitignores, we need to prefix with the relative path
        // e.g., if in `packages/app/.gitignore` with pattern `dist`
        // it should match `packages/app/dist`
        ig.add(path.join(relativeDir, trimmed));
      } else {
        ig.add(trimmed);
      }
    }
  }

  // Return a filter function that returns true if file should be INCLUDED
  return (filePath: string): boolean => {
    // Convert to absolute path if it's not already
    const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(targetDir, filePath);

    // Get relative path from target directory
    const relativePath = path.relative(targetDir, absolutePath);

    // Skip .tsx files check - only include .tsx files
    if (!relativePath.endsWith(".tsx")) {
      return false;
    }

    // Check if the file is ignored
    return !ig.ignores(relativePath);
  };
}

function findGitignoreFiles(dir: string, results: string[] = []): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      // Skip known-ignored directories entirely — avoids traversing
      // thousands of irrelevant subdirectories (e.g. node_modules, .git)
      if (SKIP_DIRS.has(entry.name)) {
        continue;
      }

      // Check for .gitignore in this directory
      const gitignorePath = path.join(fullPath, ".gitignore");
      if (fs.existsSync(gitignorePath)) {
        results.push(gitignorePath);
      }

      // Recurse into subdirectory
      findGitignoreFiles(fullPath, results);
    }
  }

  return results;
}
