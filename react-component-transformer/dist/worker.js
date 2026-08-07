import { parentPort } from "node:worker_threads";
import { transformComponents } from "./transformer.js";
if (!parentPort) {
    throw new Error("Worker must be run in a worker_threads context");
}
parentPort.on("message", (message) => {
    const result = transformComponents(message.filePath);
    parentPort.postMessage(result);
});
