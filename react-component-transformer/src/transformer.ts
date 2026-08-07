import { Project, SyntaxKind, SourceFile } from "ts-morph";
import * as path from "node:path";
import * as fs from "node:fs";
import { Console, Effect } from "effect";

export interface TransformResult {
  readonly filePath: string;
  readonly success: boolean;
  readonly message: string;
  readonly componentsFound: number;
}

export function isReactComponent(name: string): boolean {
  return /^[A-Z]/.test(name);
}

export function isTsxFile(filePath: string): boolean {
  return path.extname(filePath).toLowerCase() === ".tsx";
}

export function transformComponents(filePath: string): TransformResult {
  if (!isTsxFile(filePath)) {
    return { filePath, success: false, message: "Not a TSX file", componentsFound: 0 };
  }

  if (!fs.existsSync(filePath)) {
    return { filePath, success: false, message: "File not found", componentsFound: 0 };
  }

  try {
    const project = new Project({
      tsConfigFilePath: "tsconfig.json",
    });

    const sourceFile = project.addSourceFileAtPath(filePath);
    if (!sourceFile) {
      return { filePath, success: false, message: "Could not load source file", componentsFound: 0 };
    }

    const hasReactImport = sourceFile.getImportDeclarations().some(importDecl => {
      return importDecl.getModuleSpecifierValue() === "react";
    });

    if (!hasReactImport) {
      sourceFile.addImportDeclaration({
        moduleSpecifier: "react",
        defaultImport: "React",
      });
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
          const propsTypeName = `${componentName}Props`;

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

          functionDeclaration.setBodyText(`\n  const ${destructuringPattern} = props;\n\n  ${bodyContent}\n`);
        }

        statement.remove();
        transformedCount++;
      }
    }

    sourceFile.saveSync();

    return {
      filePath,
      success: true,
      message: transformedCount > 0 ? `Transformed ${transformedCount} components` : "No components to transform",
      componentsFound: transformedCount,
    };
  } catch (error) {
    return {
      filePath,
      success: false,
      message: error instanceof Error ? error.message : "Unknown error",
      componentsFound: 0,
    };
  }
}