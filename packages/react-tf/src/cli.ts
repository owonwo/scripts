#!/usr/bin/env node

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { Args, Command, Options } from "@effect/cli";
import { FileSystem } from "@effect/platform";
import { NodeContext, NodeFileSystem, NodeRuntime } from "@effect/platform-node";
import { CliErrorHandler } from "@wigxel/cli-core";
import { Console, Effect } from "effect";
import { loadAndFilterFiles, saveCacheResults } from "./cache.js";
import { createGitignoreFilter } from "./gitignore.js";
import type { TransformResult } from "./transformer.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Inline worker code for self-contained binary
// Uses lazy-init for ts-morph Project to defer expensive startup cost
export const WORKER_CODE = `
const { parentPort } = require("node:worker_threads");
const fs = require("node:fs");
const path = require("node:path");

if (!parentPort) {
  throw new Error("Worker must be run in a worker_threads context");
}

// Lazy-init ts-morph Project — only create when a file actually needs transformation
let project = null;
function getProject() {
  if (!project) {
    const { Project } = require("ts-morph");
    project = new Project({ tsConfigFilePath: "tsconfig.json" });
  }
  return project;
}

function isReactComponent(name) {
  return /^[A-Z]/.test(name);
}

function isTsxFile(filePath) {
  return path.extname(filePath).toLowerCase() === ".tsx";
}

parentPort.on("message", (message) => {
  if (message.done) {
    process.exit(0);
  }

  const { filePath } = message;
  const start = performance.now();

  if (!isTsxFile(filePath)) {
    parentPort.postMessage({ filePath, success: false, message: "Not a TSX file", componentsFound: 0, duration: 0 });
    return;
  }

  if (!fs.existsSync(filePath)) {
    parentPort.postMessage({ filePath, success: false, message: "File not found", componentsFound: 0, duration: 0 });
    return;
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const hasPotentialComponents = /(?:export\\s+)?(?:const|let|var)\\s+[A-Z]/.test(content) ||
    /(?:export\\s+)?function\\s+[A-Z]/.test(content);

  if (!hasPotentialComponents) {
    const duration = performance.now() - start;
    parentPort.postMessage({ filePath, success: true, message: "No components to transform", componentsFound: 0, duration });
    return;
  }

  try {
    const proj = getProject();
    const { SyntaxKind } = require("ts-morph");
    const sourceFile = proj.addSourceFileAtPath(filePath);

    const variableStatements = sourceFile.getStatements().filter(statement => {
      return statement.isKind(SyntaxKind.VariableStatement);
    });

    let transformedCount = 0;

    for (const statement of variableStatements) {
      const variableStatement = statement.asKindOrThrow(SyntaxKind.VariableStatement);
      const declarationList = variableStatement.getDeclarationList();
      const declarations = declarationList.getDeclarations();

      for (const declaration of declarations) {
        const componentName = declaration.getName();

        if (!isReactComponent(componentName)) {
          continue;
        }

        const initializer = declaration.getInitializer();
        if (!initializer) continue;

        if (!initializer.isKind(SyntaxKind.ArrowFunction)) continue;

        const arrowFunc = initializer.asKindOrThrow(SyntaxKind.ArrowFunction);
        const parameters = arrowFunc.getParameters();

        if (parameters.length > 1) continue;

        const arrowFuncBody = arrowFunc.getBody();
        const bodyText = arrowFuncBody.getText();
        const bodyContent = bodyText.slice(1, -1).trim();

        let functionDeclaration;

        if (parameters.length === 0) {
          functionDeclaration = sourceFile.addFunction({
            name: componentName,
            isExported: variableStatement.isExported(),
            isDefaultExport: variableStatement.isDefaultExport(),
          });
        } else {
          const firstParam = parameters[0];
          const typeNode = firstParam.getTypeNode();

          if (!typeNode || !typeNode.isKind(SyntaxKind.TypeLiteral)) continue;

          const typeLiteral = typeNode.asKindOrThrow(SyntaxKind.TypeLiteral);
          const destructuringPattern = firstParam.getName();
          const propsTypeName = componentName + "Props";

          sourceFile.addTypeAlias({
            name: propsTypeName,
            type: typeLiteral.getText(),
            isExported: variableStatement.isExported(),
          });

          functionDeclaration = sourceFile.addFunction({
            name: componentName,
            parameters: [
              {
                name: "props",
                type: propsTypeName,
              },
            ],
            isExported: variableStatement.isExported(),
            isDefaultExport: variableStatement.isDefaultExport(),
          });

          functionDeclaration.setBodyText("\\n  const " + destructuringPattern + " = props;\\n\\n  " + bodyContent + "\\n");
        }

        statement.remove();
        transformedCount++;
      }
    }

    const allFuncTransformations = [];

    const functionDeclarations = sourceFile.getFunctions().filter(func => {
      const name = func.getName();
      return name && isReactComponent(name);
    });

    for (const func of functionDeclarations) {
      const parameters = func.getParameters();
      if (parameters.length !== 1) continue;

      const firstParam = parameters[0];
      const typeNode = firstParam.getTypeNode();

      if (!typeNode) continue;

      const componentName = func.getName();
      const destructuringPattern = firstParam.getName();
      const isExported = func.isExported();
      const isDefaultExport = func.isDefaultExport();

      const body = func.getBody();
      if (!body) continue;
      const bodyText = body.getText();
      const bodyContent = bodyText.slice(1, -1).trim();

      if (typeNode.isKind(SyntaxKind.TypeLiteral)) {
        const typeLiteral = typeNode.asKindOrThrow(SyntaxKind.TypeLiteral);
        allFuncTransformations.push({
          componentName,
          typeText: typeLiteral.getText(),
          typeName: "",
          destructuringPattern,
          isExported,
          isDefaultExport,
          bodyContent,
          isInlineType: true,
        });
      } else {
        if (firstParam.getNameNode().getKind() !== SyntaxKind.ObjectBindingPattern) continue;

        const objectPattern = firstParam.getNameNode().asKindOrThrow(SyntaxKind.ObjectBindingPattern);
        const properties = objectPattern.getElements();

        const hasThreeOrMoreProps = properties.length >= 3;
        const hasDefaultValues = properties.some((prop) => {
          return prop.getInitializer() !== undefined;
        });

        if (!hasThreeOrMoreProps && !hasDefaultValues) continue;

        allFuncTransformations.push({
          componentName,
          typeText: "",
          typeName: typeNode.getText(),
          destructuringPattern,
          isExported,
          isDefaultExport,
          bodyContent,
          isInlineType: false,
        });
      }

      func.remove();
    }

    for (const transformation of allFuncTransformations) {
      const { componentName, typeText, typeName, destructuringPattern, isExported, isDefaultExport, bodyContent, isInlineType } = transformation;

      if (isInlineType) {
        const propsTypeName = componentName + "Props";
        sourceFile.addTypeAlias({
          name: propsTypeName,
          type: typeText,
          isExported,
        });

        const newFunc = sourceFile.addFunction({
          name: componentName,
          parameters: [{
            name: "props",
            type: propsTypeName,
          }],
          isExported,
          isDefaultExport,
        });

        if (destructuringPattern !== "props") {
          // Fix rest element naming conflict: ...props -> ...restProps
          const fixedPattern = destructuringPattern.replace(/\\.\\.\\.props\\b/g, "...restProps");
          const fixedBodyContent = fixedPattern !== destructuringPattern
            ? bodyContent.replace(/\\.\\.\\.props\\b/g, "...restProps")
            : bodyContent;
          newFunc.setBodyText("\\n  const " + fixedPattern + " = props;\\n\\n  " + fixedBodyContent + "\\n");
        } else {
          newFunc.setBodyText("\\n  " + bodyContent + "\\n");
        }
      } else {
        const newFunc = sourceFile.addFunction({
          name: componentName,
          parameters: [{
            name: "props",
            type: typeName,
          }],
          isExported,
          isDefaultExport,
        });

        // Fix rest element naming conflict: ...props -> ...restProps
        const fixedPattern = destructuringPattern.replace(/\\.\\.\\.props\\b/g, "...restProps");
        const fixedBodyContent = fixedPattern !== destructuringPattern
          ? bodyContent.replace(/\\.\\.\\.props\\b/g, "...restProps")
          : bodyContent;
        newFunc.setBodyText("\\n  const " + fixedPattern + " = props;\\n\\n  " + fixedBodyContent + "\\n");
      }

      transformedCount++;
    }

    sourceFile.saveSync();
    const duration = performance.now() - start;

    parentPort.postMessage({
      filePath,
      success: true,
      message: transformedCount > 0 ? "Transformed " + transformedCount + " components" : "No components to transform",
      componentsFound: transformedCount,
      duration,
    });
  } catch (error) {
    const duration = performance.now() - start;
    parentPort.postMessage({
      filePath,
      success: false,
      message: error instanceof Error ? error.message : "Unknown error",
      componentsFound: 0,
      duration,
    });
  }
});
`;

const paths = Args.path({ name: "path" }).pipe(Args.repeated);
const workers = Options.integer("workers").pipe(Options.withAlias("w"), Options.withDefault(4));
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
        const cacheDir = resolvedDir.startsWith(process.cwd())
          ? resolvedDir
          : process.cwd();

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
          `Found ${filesToProcess.length} files to transform with ${workers} workers...`,
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
              const worker = new Worker(WORKER_CODE, { eval: true });

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
                  console.log(`  ${color}${String(duration).padStart(5)}ms${reset}  ${relativePath}`);
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

Command.run(command, { name: "nurm", version: "1.0.0" })(process.argv).pipe(
  Effect.provide(NodeContext.layer),
  Effect.provide(NodeFileSystem.layer),
  CliErrorHandler.formatErrors,
  NodeRuntime.runMain,
);
