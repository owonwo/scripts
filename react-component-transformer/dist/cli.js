#!/usr/bin/env node
import { Args, Command, Options } from "@effect/cli";
import { FileSystem } from "@effect/platform";
import { NodeContext, NodeFileSystem, NodeRuntime } from "@effect/platform-node";
import { Console, Effect } from "effect";
import { Worker } from "node:worker_threads";
import * as path from "node:path";
const directory = Args.directory({ name: "directory" }).pipe(Args.withDefault("."));
const workers = Options.integer("workers").pipe(Options.withAlias("w"), Options.withDefault(4));
function filterTsxFiles(files) {
    return files.filter((file) => file.endsWith(".tsx") &&
        !file.includes("node_modules") &&
        !file.includes("dist") &&
        !file.includes(".next") &&
        !file.includes("build") &&
        !file.includes(".git"));
}
const command = Command.make("react-component-transformer", { directory, workers }, ({ directory, workers }) => Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const resolvedDir = path.resolve(directory);
    yield* Console.log(`Scanning ${resolvedDir} for .tsx files...`);
    const allFiles = yield* fs.readDirectory(resolvedDir, { recursive: true });
    const files = filterTsxFiles(allFiles).map((file) => path.join(resolvedDir, file));
    if (files.length === 0) {
        yield* Console.log("No .tsx files found.");
        return;
    }
    yield* Console.log(`Found ${files.length} .tsx files. Transforming with ${workers} workers...`);
    const results = [];
    const chunkSize = Math.ceil(files.length / workers);
    const chunks = [];
    for (let i = 0; i < files.length; i += chunkSize) {
        chunks.push(files.slice(i, i + chunkSize));
    }
    const workerPromises = chunks.map((chunk) => Effect.gen(function* () {
        return yield* Effect.async((resume) => {
            const workerResults = [];
            let completed = 0;
            const worker = new Worker("./worker.js");
            worker.on("message", (result) => {
                workerResults.push(result);
                completed++;
                if (completed === chunk.length) {
                    worker.terminate();
                    resume(Effect.succeed(workerResults));
                }
            });
            worker.on("error", (error) => {
                resume(Effect.fail(error));
            });
            for (const filePath of chunk) {
                worker.postMessage({ filePath });
            }
        });
    }));
    const allResults = yield* Effect.forEach(workerPromises, (effect) => effect, { concurrency: 40 });
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
}));
Command.run(command, { name: "react-component-transformer", version: "1.0.0" })(process.argv).pipe(Effect.provide(NodeContext.layer), Effect.provide(NodeFileSystem.layer), NodeRuntime.runMain);
