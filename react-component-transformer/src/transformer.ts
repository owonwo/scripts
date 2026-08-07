import { Project, SyntaxKind, SourceFile } from "ts-morph";
import * as path from "node:path";
import * as fs from "node:fs";

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

let sharedProject: Project | null = null;

export function getSharedProject(): Project {
  if (!sharedProject) {
    sharedProject = new Project({
      tsConfigFilePath: "tsconfig.json",
    });
  }
  return sharedProject;
}

export function transformComponents(
  filePath: string,
  project?: Project
): TransformResult {
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
  const hasPotentialComponents = /(?:export\s+)?(?:const|let|var)\s+[A-Z]/.test(content) ||
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
      return { filePath, success: false, message: "Could not load source file", componentsFound: 0, duration };
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

          // Fix rest element naming conflict: ...props -> ...restProps
          const fixedPattern = destructuringPattern.replace(/\.\.\.props\b/g, "...restProps");
          const fixedBodyContent = fixedPattern !== destructuringPattern 
            ? bodyContent.replace(/\.\.\.props\b/g, "...restProps")
            : bodyContent;
          functionDeclaration.setBodyText(`\n  const ${fixedPattern} = props;\n\n  ${fixedBodyContent}\n`);
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
      bodyContent: string;
      isInlineType: boolean;
    }> = [];

    // Get fresh list of functions
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

      const componentName = func.getName()!;
      const destructuringPattern = firstParam.getName();
      const isExported = func.isExported();

      // Get function body content
      const body = func.getBody();
      if (!body) continue;
      const bodyText = body.getText();
      const bodyContent = bodyText.slice(1, -1).trim();

      if (typeNode.isKind(SyntaxKind.TypeLiteral)) {
        // Inline type literal - always transform
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
        // Named type - check if needs transformation (>=3 props or has defaults)
        if (firstParam.getNameNode().getKind() !== SyntaxKind.ObjectBindingPattern) continue;

        const objectPattern = firstParam.getNameNode().asKindOrThrow(SyntaxKind.ObjectBindingPattern);
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
          bodyContent,
          isInlineType: false,
        });
      }

      // Remove the old function
      func.remove();
    }

    // Apply all transformations
    for (const transformation of allFuncTransformations) {
      const { componentName, typeText, typeName, destructuringPattern, isExported, bodyContent, isInlineType } = transformation;

      if (isInlineType) {
        // Inline type - extract to type alias
        const propsTypeName = `${componentName}Props`;
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
          const fixedPattern = destructuringPattern.replace(/\.\.\.props\b/g, "...restProps");
          const fixedBodyContent = fixedPattern !== destructuringPattern 
            ? bodyContent.replace(/\.\.\.props\b/g, "...restProps")
            : bodyContent;
          newFunc.setBodyText(`\n  const ${fixedPattern} = props;\n\n  ${fixedBodyContent}\n`);
        } else {
          newFunc.setBodyText(`\n  ${bodyContent}\n`);
        }
      } else {
        // Named type - move destructuring to body
        const newFunc = sourceFile.addFunction({
          name: componentName,
          parameters: [{
            name: "props",
            type: typeName,
          }],
          isExported,
        });

        // Fix rest element naming conflict: ...props -> ...restProps
        const fixedPattern = destructuringPattern.replace(/\.\.\.props\b/g, "...restProps");
        const fixedBodyContent = fixedPattern !== destructuringPattern 
          ? bodyContent.replace(/\.\.\.props\b/g, "...restProps")
          : bodyContent;
        newFunc.setBodyText(`\n  const ${fixedPattern} = props;\n\n  ${fixedBodyContent}\n`);
      }

      transformedCount++;
    }

    sourceFile.saveSync();
    const duration = performance.now() - start;

    return {
      filePath,
      success: true,
      message: transformedCount > 0 ? `Transformed ${transformedCount} components` : "No components to transform",
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