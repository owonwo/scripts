#!/usr/bin/env node

import { Args, Command, Options } from "@effect/cli";
import { FileSystem } from "@effect/platform";
import { NodeContext, NodeFileSystem, NodeRuntime } from "@effect/platform-node";
import { Console, Effect } from "effect";
import { Worker } from "node:worker_threads";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { TransformResult } from "./transformer.js";
import { loadAndFilterFiles, saveCacheResults } from "./cache.js";
import { createGitignoreFilter } from "./gitignore.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Inline worker code for self-contained binary
const WORKER_CODE = `
const { parentPort } = require("node:worker_threads");
const { Project } = require("ts-morph");

if (!parentPort) {
  throw new Error("Worker must be run in a worker_threads context");
}

const project = new Project({
  tsConfigFilePath: "tsconfig.json",
});

parentPort.on("message", (message) => {
  const { filePath } = message;
  const fs = require("node:fs");
  const path = require("node:path");

  const start = performance.now();

  function isReactComponent(name) {
    return /^[A-Z]/.test(name);
  }

  function isTsxFile(filePath) {
    return path.extname(filePath).toLowerCase() === ".tsx";
  }

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
    const { SyntaxKind } = require("ts-morph");
    const sourceFile = project.addSourceFileAtPath(filePath);

    function isReactComponent(name) {
      return /^[A-Z]/.test(name);
    }

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
          bodyContent,
          isInlineType: false,
        });
      }

      func.remove();
    }

    for (const transformation of allFuncTransformations) {
      const { componentName, typeText, typeName, destructuringPattern, isExported, bodyContent, isInlineType } = transformation;

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

const directory = Args.directory({ name: "directory" }).pipe(Args.withDefault("."));
const workers = Options.integer("workers").pipe(
  Options.withAlias("w"),
  Options.withDefault(4)
);
const debug = Options.boolean("debug").pipe(
  Options.withAlias("d"),
  Options.withDefault(false)
);
const force = Options.boolean("force").pipe(
  Options.withAlias("f"),
  Options.withDefault(false)
);

const command = Command.make(
  "react-component-transformer",
  { directory, workers, debug, force },
  ({ directory, workers, debug, force }) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const resolvedDir = path.resolve(directory);

      yield* Console.log(`Scanning ${resolvedDir} for .tsx files...`);

      const allFiles = yield* fs.readDirectory(resolvedDir, { recursive: true });
      const filterTsx = createGitignoreFilter(resolvedDir);
      const files = allFiles.filter(filterTsx).map((file) =>
        path.join(resolvedDir, file)
      );

      if (files.length === 0) {
        yield* Console.log("No .tsx files found.");
        return;
      }

      // Load cache and filter files
      const { filesToProcess, cachedResults } = yield* Effect.tryPromise({
        try: () => loadAndFilterFiles(resolvedDir, files, force, debug),
        catch: (error) => new Error(`Cache load failed: ${error}`)
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
          `${cachedTransformResults.length} files cached (use --force to reprocess)`
        );
      }

      if (filesToProcess.length === 0) {
        yield* Console.log("All files cached. Nothing to transform.");
        return;
      }

      yield* Console.log(
        `Found ${filesToProcess.length} files to transform with ${workers} workers...`
      );

      const results: TransformResult[] = [...cachedTransformResults];

      const chunkSize = Math.ceil(filesToProcess.length / workers);
      const chunks: string[][] = [];
      for (let i = 0; i < filesToProcess.length; i += chunkSize) {
        chunks.push(filesToProcess.slice(i, i + chunkSize));
      }

      const green = "\x1b[32m";
      const yellow = "\x1b[33m";
      const red = "\x1b[31m";
      const reset = "\x1b[0m";
      let headerPrinted = false;

      const workerPromises = chunks.map((chunk) =>
        Effect.gen(function* () {
          return yield* Effect.async<TransformResult[], never>((resume) => {
            const workerResults: TransformResult[] = [];
            let completed = 0;

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
              completed++;
              if (completed === chunk.length) {
                worker.terminate();
                resume(Effect.succeed(workerResults));
              }
            });

            worker.on("error", (error) => {
              resume(Effect.fail(error as never));
            });

            for (const filePath of chunk) {
              if (debug) {
                const relativePath = filePath.replace(resolvedDir + "/", "");
                console.log(`  writing: ${relativePath}`);
              }
              worker.postMessage({ filePath });
            }
          });
        })
      );

      const allResults = yield* Effect.forEach(
        workerPromises,
        (effect) => effect,
        { concurrency: 40 }
      );

      for (const chunkResults of allResults) {
        results.push(...chunkResults);
      }

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
        try: () => saveCacheResults(resolvedDir, files, cacheData),
        catch: (error) => new Error(`Cache save failed: ${error}`)
      });
    })
);

Command.run(command, { name: "react-component-transformer", version: "1.0.0" })(
  process.argv
).pipe(
  Effect.provide(NodeContext.layer),
  Effect.provide(NodeFileSystem.layer),
  NodeRuntime.runMain
);