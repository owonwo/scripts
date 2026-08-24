import fs from "node:fs";
import path from "node:path";
import { parentPort } from "node:worker_threads";
import type { Project } from "ts-morph";
import { buildTransformedSource, collectTransformations } from "./transform-core.js";

if (!parentPort) {
  throw new Error("Worker must be run in a worker_threads context");
}

let project: Project | null = null;

async function getProject() {
  if (!project) {
    const { Project } = await import("ts-morph");
    project = new Project({ tsConfigFilePath: "tsconfig.json" });
  }
  return project;
}

if (!parentPort) {
  throw new Error("Worker must be run in a worker_threads context");
}

const port = parentPort;

port.on("message", async (message) => {
  if (message.done) {
    process.exit(0);
  }

  const { filePath } = message;
  const start = performance.now();

  if (path.extname(filePath).toLowerCase() !== ".tsx") {
    port.postMessage({ filePath, success: false, message: "Not a TSX file", componentsFound: 0, duration: 0 });
    return;
  }

  if (!fs.existsSync(filePath)) {
    port.postMessage({ filePath, success: false, message: "File not found", componentsFound: 0, duration: 0 });
    return;
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const hasPotentialComponents = /(?:export\s+)?(?:const|let|var)\s+[A-Z]/.test(content) ||
    /(?:export\s+)?function\s+[A-Z]/.test(content);

  if (!hasPotentialComponents) {
    const duration = performance.now() - start;
    port.postMessage({ filePath, success: true, message: "No components to transform", componentsFound: 0, duration });
    return;
  }

  try {
    const proj = await getProject();
    const { SyntaxKind } = await import("ts-morph");
    const sourceFile = proj.addSourceFileAtPath(filePath);

    let defaultExportName = null;
    const exportAssignments = sourceFile.getStatements()
      .filter(s => s.isKind(SyntaxKind.ExportAssignment));
    for (const ea of exportAssignments) {
      defaultExportName = ea.asKindOrThrow(SyntaxKind.ExportAssignment).getExpression().getText();
      ea.remove();
    }

    const transformations = collectTransformations(sourceFile);
    let result = buildTransformedSource(sourceFile.getFullText(), transformations);

    if (defaultExportName) {
      result += "\nexport default " + defaultExportName + ";";
    }

    sourceFile.replaceWithText(result);
    sourceFile.saveSync();

    const duration = performance.now() - start;
    port.postMessage({
      filePath,
      success: true,
      message: transformations.length > 0 ? "Transformed " + transformations.length + " components" : "No components to transform",
      componentsFound: transformations.length,
      duration,
    });
  } catch (error) {
    const duration = performance.now() - start;
    port.postMessage({
      filePath,
      success: false,
      message: error instanceof Error ? error.message : "Unknown error",
      componentsFound: 0,
      duration,
    });
  }
});
