import { Worker } from "node:worker_threads";
import { parentPort } from "node:worker_threads";
import { transformComponents, type TransformResult } from "./transformer.js";

if (!parentPort) {
  throw new Error("Worker must be run in a worker_threads context");
}

parentPort.on("message", (message: { filePath: string }) => {
  const result: TransformResult = transformComponents(message.filePath);
  parentPort!.postMessage(result);
});