import { parentPort } from "node:worker_threads";
import { transformComponents } from "./transformer";

if (!parentPort) {
  throw new Error("Worker must be run in a worker_threads context");
}

parentPort.on("message", async (message) => {
  if (message.done) {
    process.exit(0);
  }

  try {
    const result = await transformComponents(message.filePath);
    parentPort.postMessage(result);
  } catch (error) {
    parentPort.postMessage({
      filePath: message.filePath,
      success: false,
      message: error instanceof Error ? error.message : "Unknown error",
      componentsFound: 0,
      duration: 0,
    });
  }
});
