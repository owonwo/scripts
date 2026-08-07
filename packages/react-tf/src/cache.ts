import { FileHashCache } from "fast-fs-hash";
import * as path from "node:path";
import * as fs from "node:fs";

const CACHE_DIR = "node_modules/.cache/react-component-transformer";
const CACHE_FILE = "transformer-cache.fsh";
const CACHE_VERSION = 1;

export interface CacheEntry {
  hash: string;
  transformed: boolean;
  componentsFound: number;
}

export type CacheStore = Record<string, CacheEntry>;

// Metadata stored in the cache payload
interface CachePayload {
  transformed: Record<string, boolean>;
  componentsFound: Record<string, number>;
}

let globalCache: FileHashCache | null = null;
let cachedProjectRoot: string | null = null;

/**
 * Find the project root by walking up from startDir looking for package.json.
 * For monorepos, continues walking up to find the workspace root.
 */
export function findProjectRoot(startDir: string): string {
  let currentDir = path.resolve(startDir);
  const root = path.parse(currentDir).root;

  let lastPackageJsonDir: string | null = null;

  while (currentDir !== root) {
    const packageJsonPath = path.join(currentDir, "package.json");

    if (fs.existsSync(packageJsonPath)) {
      try {
        const content = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));

        // Check if this is a workspace root
        if (content.workspaces) {
          return currentDir;
        }

        // Check for monorepo indicators at this level
        if (
          fs.existsSync(path.join(currentDir, "pnpm-workspace.yaml")) ||
          fs.existsSync(path.join(currentDir, "lerna.json"))
        ) {
          return currentDir;
        }

        // Remember this as the nearest package.json
        lastPackageJsonDir = currentDir;
      } catch {
        // Invalid package.json, continue
      }
    }

    // Move up
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) break;
    currentDir = parentDir;
  }

  // Check if root itself has package.json
  if (fs.existsSync(path.join(root, "package.json"))) {
    try {
      const content = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf-8"));
      if (content.workspaces) {
        return root;
      }
    } catch {
      // Invalid package.json
    }
  }

  if (lastPackageJsonDir) {
    return lastPackageJsonDir;
  }

  throw new Error(
    `Could not find project root. No package.json found starting from "${startDir}".`,
  );
}

function getCache(targetDir: string): FileHashCache {
  if (!globalCache) {
    const projectRoot = findProjectRoot(targetDir);
    cachedProjectRoot = projectRoot;

    const cacheDir = path.join(projectRoot, CACHE_DIR);
    fs.mkdirSync(cacheDir, { recursive: true });

    globalCache = new FileHashCache({
      cachePath: path.join(cacheDir, CACHE_FILE),
      rootPath: projectRoot,
      version: CACHE_VERSION,
    });
  }
  return globalCache;
}

export function getProjectRoot(): string {
  return cachedProjectRoot;
}

export async function loadAndFilterFiles(
  targetDir: string,
  files: string[],
  force: boolean,
  debug: boolean,
): Promise<{
  filesToProcess: string[];
  cachedResults: { filePath: string; transformed: boolean; componentsFound: number }[];
}> {
  const cache = getCache(targetDir);

  if (force) {
    // Force mode: skip cache, process all files
    cache.configure({ files });
    return { filesToProcess: files, cachedResults: [] };
  }

  // Set the current file list
  cache.configure({ files });

  const session = await cache.open();

  try {
    if (session.status === "upToDate") {
      // All files unchanged, load metadata from payload
      const payload: CachePayload | null =
        session.compressedPayloads.length > 0
          ? JSON.parse(session.compressedPayloads[0].toString())
          : null;

      if (payload) {
        const cachedResults = files.map((filePath) => ({
          filePath,
          transformed: payload.transformed[filePath] ?? false,
          componentsFound: payload.componentsFound[filePath] ?? 0,
        }));
        return { filesToProcess: [], cachedResults };
      }
    }

    // Some files changed or no cache exists
    if (session.status !== "missing" && session.compressedPayloads.length > 0) {
      // Resolve to get per-file changes
      const entries = await session.resolve();
      const payload: CachePayload = JSON.parse(session.compressedPayloads[0].toString());

      const filesToProcess: string[] = [];
      const cachedResults: { filePath: string; transformed: boolean; componentsFound: number }[] =
        [];

      for (const entry of entries) {
        if (entry.changed) {
          filesToProcess.push(entry.path);
        } else {
          // File unchanged, use cached result
          cachedResults.push({
            filePath: entry.path,
            transformed: payload.transformed[entry.path] ?? false,
            componentsFound: payload.componentsFound[entry.path] ?? 0,
          });
          if (debug) {
            const projectRoot = getProjectRoot();
            const relativePath = path.relative(projectRoot, entry.path);
            console.log(`  \x1b[90mcached:\x1b[0m ${relativePath}`);
          }
        }
      }

      return { filesToProcess, cachedResults };
    }

    // No cache or stale cache, process all files
    return { filesToProcess: files, cachedResults: [] };
  } finally {
    await session.close();
  }
}

export async function saveCacheResults(
  targetDir: string,
  files: string[],
  results: { filePath: string; transformed: boolean; componentsFound: number }[],
): Promise<void> {
  const cache = getCache(targetDir);

  // Build metadata payload
  const payload: CachePayload = {
    transformed: {},
    componentsFound: {},
  };

  for (const result of results) {
    payload.transformed[result.filePath] = result.transformed;
    payload.componentsFound[result.filePath] = result.componentsFound;
  }

  // Ensure cache has the current file list
  cache.configure({ files });

  const session = await cache.open();
  try {
    await session.write({
      compressedPayloads: [Buffer.from(JSON.stringify(payload))],
    });
  } finally {
    await session.close();
  }
}
