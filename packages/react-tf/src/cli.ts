#!/usr/bin/env node

import * as fs from "node:fs";
import * as path from "node:path";
import { Worker } from "node:worker_threads";
import { Args, Command, Options } from "@effect/cli";
import { FileSystem } from "@effect/platform";
import { NodeContext, NodeFileSystem, NodeRuntime } from "@effect/platform-node";
import { PositiveInteger } from "@wigxel/cli-core";
import { Console, Effect } from "effect";
import { loadAndFilterFiles, saveCacheResults } from "./cache.js";
import { createGitignoreFilter } from "./gitignore.js";
import type { TransformResult } from "./transformer.js";

export const WORKER_CODE = __WORKER_CODE__;

const paths = Args.path({ name: "path" }).pipe(
  Args.repeated,
  Args.map((paths) => paths.filter((p) => !p.startsWith("--"))),
);
const workers = Options.text("workers").pipe(
  Options.withAlias("w"),
  Options.withDefault("4"),
  Options.withSchema(PositiveInteger("--workers")),
);
const debug = Options.boolean("debug").pipe(Options.withAlias("d"), Options.withDefault(false));
const force = Options.boolean("force").pipe(Options.withAlias("f"), Options.withDefault(false));

const command = Command.make(
  "react-component-transformer",
  { paths, workers, debug, force },
  ({ paths, workers, debug, force }) =>
    Effect.gen(function* () {
      const consoleFs = yield* FileSystem.FileSystem;
      const inputPaths = paths.length > 0 ? paths : ["."];

      // Collect all files to process, detecting file vs directory
      const filesByDir = new Map<string, string[]>();

      for (const input of inputPaths) {
        const resolved = path.resolve(input);
        const stat = fs.statSync(resolved);

        if (stat.isFile()) {
          const dir = path.dirname(resolved);
          const existing = filesByDir.get(dir) ?? [];
          existing.push(resolved);
          filesByDir.set(dir, existing);
        } else if (stat.isDirectory()) {
          yield* Console.log(`Scanning ${resolved} for .tsx files...`);

          const allFiles = yield* consoleFs.readDirectory(resolved, { recursive: true });
          const filterTsx = createGitignoreFilter(resolved);
          const files = allFiles.filter(filterTsx).map((file) => path.join(resolved, file));
          const tsxFiles = files.filter((f) => f.endsWith(".tsx"));

          if (tsxFiles.length === 0) {
            yield* Console.log("No .tsx files found.");
          } else {
            const existing = filesByDir.get(resolved) ?? [];
            existing.push(...tsxFiles);
            filesByDir.set(resolved, existing);
          }
        }
      }

      // Process each directory's files
      for (const [resolvedDir, allFiles] of filesByDir) {
        yield* Console.log(`Found ${allFiles.length} .tsx files. Checking cache...`);

        // Use cwd as cache root for files outside the project tree
        const cacheDir = resolvedDir.startsWith(process.cwd()) ? resolvedDir : process.cwd();

        // Load cache and filter files
        const { filesToProcess, cachedResults } = yield* Effect.tryPromise({
          try: () => loadAndFilterFiles(cacheDir, allFiles, force, debug),
          catch: (error) => new Error(`Cache load failed: ${error}`),
        });

        // Convert cached results to TransformResult format
        const cachedTransformResults: TransformResult[] = cachedResults.map((r) => ({
          filePath: r.filePath,
          success: true,
          message: r.transformed
            ? `Cached (${r.componentsFound} components)`
            : "Cached (no components)",
          componentsFound: r.componentsFound,
          duration: 0,
        }));

        if (cachedTransformResults.length > 0) {
          yield* Console.log(
            `${cachedTransformResults.length} files cached (use --force to reprocess)`,
          );
        }

        if (filesToProcess.length === 0) {
          yield* Console.log("All files cached. Nothing to transform.");
          continue;
        }

        yield* Console.log(
          `Found ${filesToProcess.length} files to transform with ${Math.min(workers, filesToProcess.length)} workers...`,
        );

        const results: TransformResult[] = [...cachedTransformResults];

        const green = "\x1b[32m";
        const yellow = "\x1b[33m";
        const red = "\x1b[31m";
        const reset = "\x1b[0m";
        let headerPrinted = false;
        let completedCount = 0;
        const totalFiles = filesToProcess.length;

        // Worker pool: create N workers, feed files one-by-one via queue
        const workerResults: TransformResult[] = [];
        let fileIndex = 0;

        const allResults: TransformResult[] = yield* Effect.async<TransformResult[], never>(
          (resume) => {
            let workersAlive = 0;
            let finished = false;

            function sendNextToWorker(worker: Worker) {
              if (fileIndex < totalFiles) {
                const filePath = filesToProcess[fileIndex++];
                worker.postMessage({ filePath });
              } else {
                worker.postMessage({ done: true });
              }
            }

            function checkDone() {
              if (finished) return;
              if (workersAlive === 0) {
                finished = true;
                resume(Effect.succeed(workerResults));
              }
            }

            const numWorkers = Math.min(workers, totalFiles);

            for (let i = 0; i < numWorkers; i++) {
              workersAlive++;
              const worker = new Worker(WORKER_CODE, { eval: true, type: "module" });

              worker.on("message", (result: unknown) => {
                const r = result as TransformResult;
                if (debug) {
                  if (!headerPrinted) {
                    console.log("");
                    console.log("  Results:");
                    headerPrinted = true;
                  }
                  const duration = Math.round(r.duration);
                  const color = duration > 500 ? red : duration > 200 ? yellow : green;
                  const relativePath = r.filePath.replace(resolvedDir + "/", "");
                  console.log(
                    `  ${color}${String(duration).padStart(5)}ms${reset}  ${relativePath}`,
                  );
                }
                workerResults.push(r);
                completedCount++;
                if (debug) {
                  console.log(`  progress: ${completedCount}/${totalFiles}`);
                }
                // Send next file to this worker
                sendNextToWorker(worker);
              });

              worker.on("error", () => {
                // Error will also trigger exit event — no need to handle separately
              });

              worker.on("exit", () => {
                workersAlive--;
                checkDone();
              });

              // Kick off the first file for this worker
              sendNextToWorker(worker);
            }
          },
        );

        results.push(...allResults);

        const transformed = results.filter((r) => r.success && r.componentsFound > 0);
        const skipped = results.filter((r) => r.success && r.componentsFound === 0);
        const errors = results.filter((r) => !r.success);

        yield* Console.log("");
        yield* Console.log(`Transformed: ${transformed.length} files`);
        yield* Console.log(`Skipped: ${skipped.length} files (no components)`);
        yield* Console.log(`Errors: ${errors.length} files`);

        if (errors.length > 0) {
          yield* Console.log("");
          for (const error of errors) {
            yield* Console.log(`  ${error.filePath}: ${error.message}`);
          }
        }

        // Save cache for all processed files
        const cacheData = results.map((r) => ({
          filePath: r.filePath,
          transformed: r.componentsFound > 0,
          componentsFound: r.componentsFound,
        }));

        yield* Effect.tryPromise({
          try: () => saveCacheResults(cacheDir, allFiles, cacheData),
          catch: (error) => new Error(`Cache save failed: ${error}`),
        });
      }
    }),
);

Command.run(command, { name: "nurm", version: __VERSION__ })(process.argv).pipe(
  Effect.provide(NodeContext.layer),
  Effect.provide(NodeFileSystem.layer),
  Effect.catchAll(() => Effect.void),
  NodeRuntime.runMain,
);
