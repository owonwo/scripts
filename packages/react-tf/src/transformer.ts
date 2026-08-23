import * as fs from "node:fs";
import * as path from "node:path";
import { Project, SyntaxKind } from "ts-morph";

export interface TransformResult {
  readonly filePath: string;
  readonly success: boolean;
  readonly message: string;
  readonly componentsFound: number;
  readonly duration: number;
}

export function isReactComponent(name: string): boolean {
  return /^[A-Z]/.test(name);
}

export function isTsxFile(filePath: string): boolean {
  return path.extname(filePath).toLowerCase() === ".tsx";
}

function isComplexType(typeNode: any): boolean {
  const kind = typeNode.getKind();
  // TypeReference (e.g. BoxProps, React.ComponentProps<...>) and QualifiedName are named types
  if (kind === SyntaxKind.TypeReference || kind === SyntaxKind.QualifiedName) return false;
  // TypeLiteral, IntersectionType, UnionType, etc. are complex inline types
  return true;
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

  // Quick check: does file contain any uppercase variable declarations or function declarations?
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

    const variableStatements = sourceFile.getStatements().filter((statement) => {
      return statement.isKind(SyntaxKind.VariableStatement);
    });

    // Collect and remove separate `export default X;` statement
    let defaultExportName: string | null = null;
    const exportAssignments = sourceFile.getStatements()
      .filter(s => s.isKind(SyntaxKind.ExportAssignment));
    for (const ea of exportAssignments) {
      defaultExportName = ea.asKindOrThrow(SyntaxKind.ExportAssignment).getExpression().getText();
      ea.remove();
    }

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
            isAsync: arrowFunc.isAsync(),
          });
        } else {
          const firstParam = parameters[0];
          const typeNode = firstParam.getTypeNode();

          if (!typeNode || !isComplexType(typeNode)) continue;

          const destructuringPattern = firstParam.getName();
          const propsTypeName = `${componentName}Props`;

          sourceFile.addTypeAlias({
            name: propsTypeName,
            type: typeNode.getText(),
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
            isAsync: arrowFunc.isAsync(),
          });

          // Fix rest element naming conflict: ...props -> ...restProps
          const fixedPattern = destructuringPattern.replace(/\.\.\.props\b/g, "...restProps");
          const fixedBodyContent =
            fixedPattern !== destructuringPattern
              ? bodyContent.replace(/\.\.\.props\b/g, "...restProps")
              : bodyContent;
          if (fixedPattern !== "props") {
            functionDeclaration.setBodyText(
              `\n  const ${fixedPattern} = props;\n\n  ${fixedBodyContent}\n`,
            );
          } else {
            functionDeclaration.setBodyText(`\n  ${fixedBodyContent}\n`);
          }
        }

        statement.remove();
        transformedCount++;
      }
    }

    // Handle function declarations - collect all transformations first
    const allFuncTransformations: Array<{
      componentName: string;
      typeText: string;
      typeName: string;
      destructuringPattern: string;
      isExported: boolean;
      isDefaultExport: boolean;
      bodyContent: string;
      isInlineType: boolean;
      jsDocs: string[];
      isAsync: boolean;
      start: number;
      end: number;
    }> = [];

    const functionDeclarations = sourceFile.getFunctions().filter((func) => {
      const name = func.getName();
      return name && isReactComponent(name);
    });

    for (const func of functionDeclarations) {
      const parameters = func.getParameters();
      if (parameters.length !== 1) continue;

      const firstParam = parameters[0];
      const typeNode = firstParam.getTypeNode();

      if (!typeNode) continue;

      const componentName = func.getName()!;
      const destructuringPattern = firstParam.getName();
      const isExported = func.isExported();
      const isDefaultExport = func.getModifiers().some(m => m.getKind() === SyntaxKind.DefaultKeyword);

      const body = func.getBody();
      if (!body) continue;
      const bodyText = body.getText();
      const bodyContent = bodyText.slice(1, -1).trim();

      const jsDocs = func.getJsDocs().map(doc => doc.getCommentText() ?? "");
      const isAsync = func.isAsync();

      // Position range [start, end) in the original source text
      const start = func.getFullStart();
      const end = func.getEnd();

      if (isComplexType(typeNode)) {
        const propsTypeName = `${componentName}Props`;
        allFuncTransformations.push({
          componentName,
          typeText: typeNode.getText(),
          typeName: propsTypeName,
          destructuringPattern,
          isExported,
          isDefaultExport,
          bodyContent,
          isInlineType: true,
          jsDocs,
          isAsync,
          start,
          end,
        });
      } else {
        if (firstParam.getNameNode().getKind() !== SyntaxKind.ObjectBindingPattern) continue;

        const objectPattern = firstParam
          .getNameNode()
          .asKindOrThrow(SyntaxKind.ObjectBindingPattern);
        const properties = objectPattern.getElements();

        const hasThreeOrMoreProps = properties.length >= 3;
        const hasDefaultValues = properties.some((prop: any) => {
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
          jsDocs,
          isAsync,
          start,
          end,
        });
      }
    }

    // Sort by position ascending
    allFuncTransformations.sort((a, b) => a.start - b.start);

    // Build new source by processing from bottom to top
    const srcText = sourceFile.getFullText();
    let result = srcText;

    for (let i = allFuncTransformations.length - 1; i >= 0; i--) {
      const t = allFuncTransformations[i];
      const {
        componentName, typeText, typeName, destructuringPattern,
        isExported, isDefaultExport, bodyContent, isInlineType,
        jsDocs, isAsync, start, end,
      } = t;

      const propsTypeName = typeName || `${componentName}Props`;
      const lines: string[] = [];

      if (jsDocs.length > 0) {
        lines.push("/**");
        for (const line of jsDocs) {
          for (const l of line.split("\n")) {
            lines.push(` * ${l.trim()}`);
          }
        }
        lines.push(" */");
      }

      const exportPrefix = isExported ? "export " : "";
      if (isInlineType) {
        lines.push(`${exportPrefix}type ${propsTypeName} = ${typeText};`);
        lines.push("");
      }

      let funcLine = "";
      if (isExported) funcLine += "export ";
      if (isDefaultExport) funcLine += "default ";
      if (isAsync) funcLine += "async ";
      funcLine += `function ${componentName}(props: ${propsTypeName}) {`;
      lines.push(funcLine);

      if (destructuringPattern !== "props") {
        const fixedPattern = destructuringPattern.replace(/\.\.\.props\b/g, "...restProps");
        const fixedBodyContent =
          fixedPattern !== destructuringPattern
            ? bodyContent.replace(/\.\.\.props\b/g, "...restProps")
            : bodyContent;
        lines.push(`  const ${fixedPattern} = props;`);
        lines.push("");
        lines.push(`  ${fixedBodyContent}`);
      } else {
        lines.push(`  ${bodyContent}`);
      }

      lines.push("}");

      // Replace the original range [start, end) with the new text
      result = result.slice(0, start) + lines.join("\n") + result.slice(end);

      transformedCount++;
    }

    // Re-append separate export default statement at the end
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
        transformedCount > 0
          ? `Transformed ${transformedCount} components`
          : "No components to transform",
      componentsFound: transformedCount,
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
