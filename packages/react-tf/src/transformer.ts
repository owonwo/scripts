import * as fs from "node:fs";
import * as path from "node:path";
import { Project, SyntaxKind } from "ts-morph";
import { collectTransformations, buildTransformedSource } from "./transform-core.js";

export interface TransformResult {
  readonly filePath: string;
  readonly success: boolean;
  readonly message: string;
  readonly componentsFound: number;
  readonly duration: number;
}

export { isReactComponent } from "./transform-core.js";

export function isTsxFile(filePath: string): boolean {
  return path.extname(filePath).toLowerCase() === ".tsx";
}

let sharedProject: Project | null = null;

export function getSharedProject(): Project {
  if (!sharedProject) {
    sharedProject = new Project({
      tsConfigFilePath: "tsconfig.json",
    });
  }
  return sharedProject;
}

export function transformComponents(filePath: string, project?: Project): TransformResult {
  const start = performance.now();
  const proj = project ?? getSharedProject();

  if (!isTsxFile(filePath)) {
    return { filePath, success: false, message: "Not a TSX file", componentsFound: 0, duration: 0 };
  }

  if (!fs.existsSync(filePath)) {
    return { filePath, success: false, message: "File not found", componentsFound: 0, duration: 0 };
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const hasPotentialComponents =
    /(?:export\s+)?(?:const|let|var)\s+[A-Z]/.test(content) ||
    /(?:export\s+)?function\s+[A-Z]/.test(content);
  if (!hasPotentialComponents) {
    const duration = performance.now() - start;
    return {
      filePath,
      success: true,
      message: "No components to transform",
      componentsFound: 0,
      duration,
    };
  }

  try {
    const sourceFile = proj.addSourceFileAtPath(filePath);
    if (!sourceFile) {
      const duration = performance.now() - start;
      return {
        filePath,
        success: false,
        message: "Could not load source file",
        componentsFound: 0,
        duration,
      };
    }

    let defaultExportName: string | null = null;
    const exportAssignments = sourceFile.getStatements()
      .filter(s => s.isKind(SyntaxKind.ExportAssignment));
    for (const ea of exportAssignments) {
      defaultExportName = ea.asKindOrThrow(SyntaxKind.ExportAssignment).getExpression().getText();
      ea.remove();
    }

    const transformations = collectTransformations(sourceFile);
    let result = buildTransformedSource(sourceFile.getFullText(), transformations);

    if (defaultExportName) {
      result += `\nexport default ${defaultExportName};`;
    }

    sourceFile.replaceWithText(result);
    sourceFile.saveSync();

    const duration = performance.now() - start;
    return {
      filePath,
      success: true,
      message:
        transformations.length > 0
          ? `Transformed ${transformations.length} components`
          : "No components to transform",
      componentsFound: transformations.length,
      duration,
    };
  } catch (error) {
    const duration = performance.now() - start;
    return {
      filePath,
      success: false,
      message: error instanceof Error ? error.message : "Unknown error",
      componentsFound: 0,
      duration,
    };
  }
}
