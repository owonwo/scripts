import * as fs from "node:fs";
import * as path from "node:path";
import { parse } from "oxc-parser";

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

function isComplexType(typeAnnotation: any): boolean {
  if (!typeAnnotation) return false;
  const type = typeAnnotation.typeAnnotation;
  if (!type) return false;
  // TypeReference (e.g. BoxProps) is a named type — not complex
  if (type.type === "TSTypeReference") return false;
  // TSTypeLiteral, TSIntersectionType, TSUnionType, etc. are complex inline types
  return true;
}

interface AstNode {
  type: string;
  start: number;
  end: number;
  [key: string]: any;
}

function findNodes(node: AstNode, type: string): AstNode[] {
  const results: AstNode[] = [];
  if (node.type === type) results.push(node);
  for (const key of Object.keys(node)) {
    if (key === "type" || key === "start" || key === "end") continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        if (item && typeof item === "object" && item.type) {
          results.push(...findNodes(item, type));
        }
      }
    } else if (child && typeof child === "object" && child.type) {
      results.push(...findNodes(child, type));
    }
  }
  return results;
}

function findFirstNode(node: AstNode, type: string): AstNode | null {
  if (node.type === type) return node;
  for (const key of Object.keys(node)) {
    if (key === "type" || key === "start" || key === "end") continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        if (item && typeof item === "object" && item.type) {
          const found = findFirstNode(item, type);
          if (found) return found;
        }
      }
    } else if (child && typeof child === "object" && child.type) {
      const found = findFirstNode(child, type);
      if (found) return found;
    }
  }
  return null;
}

function getNodeText(node: AstNode, source: string): string {
  return source.slice(node.start, node.end);
}

function isExported(node: AstNode): boolean {
  return node.type === "ExportNamedDeclaration" || node.type === "ExportDefaultDeclaration";
}

function isDefaultExport(node: AstNode): boolean {
  return node.type === "ExportDefaultDeclaration";
}

function hasAsyncKeyword(node: AstNode): boolean {
  return node.async === true;
}

function getLeadingComments(node: AstNode, source: string): string[] {
  const comments: string[] = [];
  let pos = node.start;
  while (pos > 0) {
    const ch = source[pos - 1];
    if (ch === "\n" || ch === "\r" || ch === " " || ch === "\t") {
      pos--;
      continue;
    }
    if (source.slice(pos - 2, pos) === "*/") {
      const end = pos;
      pos -= 2;
      while (pos > 0 && source.slice(pos - 2, pos) !== "/*") pos--;
      comments.unshift(source.slice(pos, end).trim());
      pos--;
      continue;
    }
    break;
  }
  return comments;
}

function getDestructuringPatternText(param: AstNode, source: string): string {
  if (param.type === "Identifier") {
    return source.slice(param.start, param.end);
  }
  if (param.type === "ObjectPattern") {
    return source.slice(param.start, param.end);
  }
  return source.slice(param.start, param.end);
}

function hasObjectBindingPattern(param: AstNode): boolean {
  return param.type === "ObjectPattern";
}

function getObjectPatternProperties(param: AstNode): AstNode[] {
  if (param.type !== "ObjectPattern") return [];
  return (param.properties || []) as AstNode[];
}

function hasDefaultValues(param: AstNode): boolean {
  if (param.type !== "ObjectPattern") return false;
  const props = param.properties || [];
  return props.some((p: any) => p.type === "ObjectProperty" && p.value?.type === "AssignmentPattern");
}

export async function transformComponents(filePath: string): Promise<TransformResult> {
  const start = performance.now();

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
    const filename = path.basename(filePath);
    const { program } = await parse(filename, content, {
      lang: "tsx",
      sourceType: "module",
    });

    let transformedCount = 0;
    const statements = program.body || [];

    // Collect all transformations
    const allTransformations: Array<{
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
      isArrow: boolean;
      arrowBody?: string;
      arrowParams?: AstNode[];
      parentStart?: number;
      parentEnd?: number;
    }> = [];

    for (const stmt of statements) {
      // Handle VariableDeclaration (arrow functions)
      if (stmt.type === "VariableDeclaration") {
        for (const decl of stmt.declarations || []) {
          if (decl.id?.type !== "Identifier") continue;
          const componentName = decl.id.name;
          if (!isReactComponent(componentName)) continue;
          if (!decl.init) continue;
          if (decl.init.type !== "ArrowFunctionExpression") continue;

          const arrowFunc = decl.init;
          const params = arrowFunc.params || [];
          if (params.length > 1) continue;

          const body = arrowFunc.body;
          if (!body) continue;
          const bodyText = getNodeText(body, content);
          const bodyContent = bodyText.slice(1, -1).trim();

          const parentIsExport = isExported(stmt);
          const parentIsDefault = isDefaultExport(stmt);

          if (params.length === 0) {
            allTransformations.push({
              componentName,
              typeText: "",
              typeName: "",
              destructuringPattern: "props",
              isExported: parentIsExport,
              isDefaultExport: parentIsDefault,
              bodyContent,
              isInlineType: false,
              jsDocs: [],
              isAsync: false,
              start: stmt.start,
              end: stmt.end,
              isArrow: true,
              arrowBody: bodyText,
              arrowParams: params,
            });
          } else {
            const firstParam = params[0];
            const typeAnnotation = firstParam.typeAnnotation;
            if (!typeAnnotation) continue;

            const isComplex = isComplexType(typeAnnotation);
            if (!isComplex) {
              // Named type reference — check if it has 3+ props or defaults
              if (!hasObjectBindingPattern(firstParam)) continue;
              const props = getObjectPatternProperties(firstParam);
              if (props.length < 3 && !hasDefaultValues(firstParam)) continue;
            }

            const destructuringPattern = getDestructuringPatternText(firstParam, content);
            const typeText = typeAnnotation ? getNodeText(typeAnnotation.typeAnnotation, content) : "";
            const propsTypeName = `${componentName}Props`;

            allTransformations.push({
              componentName,
              typeText,
              typeName: propsTypeName,
              destructuringPattern,
              isExported: parentIsExport,
              isDefaultExport: parentIsDefault,
              bodyContent,
              isInlineType: isComplex,
              jsDocs: [],
              isAsync: false,
              start: stmt.start,
              end: stmt.end,
              isArrow: true,
              arrowBody: bodyText,
              arrowParams: params,
            });
          }
        }
      }

      // Handle ExportNamedDeclaration containing VariableDeclaration
      if (stmt.type === "ExportNamedDeclaration" && stmt.declaration?.type === "VariableDeclaration") {
        for (const decl of stmt.declaration.declarations || []) {
          if (decl.id?.type !== "Identifier") continue;
          const componentName = decl.id.name;
          if (!isReactComponent(componentName)) continue;
          if (!decl.init) continue;
          if (decl.init.type !== "ArrowFunctionExpression") continue;

          const arrowFunc = decl.init;
          const params = arrowFunc.params || [];
          if (params.length > 1) continue;

          const body = arrowFunc.body;
          if (!body) continue;
          const bodyText = getNodeText(body, content);
          const bodyContent = bodyText.slice(1, -1).trim();

          if (params.length === 0) {
            allTransformations.push({
              componentName,
              typeText: "",
              typeName: "",
              destructuringPattern: "props",
              isExported: true,
              isDefaultExport: false,
              bodyContent,
              isInlineType: false,
              jsDocs: [],
              isAsync: false,
              start: stmt.start,
              end: stmt.end,
              isArrow: true,
              arrowBody: bodyText,
              arrowParams: params,
            });
          } else {
            const firstParam = params[0];
            const typeAnnotation = firstParam.typeAnnotation;
            if (!typeAnnotation) continue;

            const isComplex = isComplexType(typeAnnotation);
            if (!isComplex) {
              if (!hasObjectBindingPattern(firstParam)) continue;
              const props = getObjectPatternProperties(firstParam);
              if (props.length < 3 && !hasDefaultValues(firstParam)) continue;
            }

            const destructuringPattern = getDestructuringPatternText(firstParam, content);
            const typeText = typeAnnotation ? getNodeText(typeAnnotation.typeAnnotation, content) : "";
            const propsTypeName = `${componentName}Props`;

            allTransformations.push({
              componentName,
              typeText,
              typeName: propsTypeName,
              destructuringPattern,
              isExported: true,
              isDefaultExport: false,
              bodyContent,
              isInlineType: isComplex,
              jsDocs: [],
              isAsync: false,
              start: stmt.start,
              end: stmt.end,
              isArrow: true,
              arrowBody: bodyText,
              arrowParams: params,
            });
          }
        }
      }

      // Handle ExportDefaultDeclaration containing FunctionDeclaration
      if (stmt.type === "ExportDefaultDeclaration" && stmt.declaration?.type === "FunctionDeclaration") {
        const func = stmt.declaration;
        if (!func.id) continue;
        const componentName = func.id.name;
        if (!isReactComponent(componentName)) continue;

        const params = func.params || [];
        if (params.length !== 1) continue;

        const firstParam = params[0];
        const typeAnnotation = firstParam.typeAnnotation;
        if (!typeAnnotation) continue;

        const isComplex = isComplexType(typeAnnotation);
        if (!isComplex) {
          if (!hasObjectBindingPattern(firstParam)) continue;
          const props = getObjectPatternProperties(firstParam);
          if (props.length < 3 && !hasDefaultValues(firstParam)) continue;
        }

        const destructuringPattern = getDestructuringPatternText(firstParam, content);
        const typeText = typeAnnotation ? getNodeText(typeAnnotation.typeAnnotation, content) : "";
        const propsTypeName = `${componentName}Props`;

        const body = func.body;
        if (!body) continue;
        const bodyText = getNodeText(body, content);
        const bodyContent = bodyText.slice(1, -1).trim();

        const jsDocs = getLeadingComments(stmt, content);
        const isAsync = hasAsyncKeyword(func);

        allTransformations.push({
          componentName,
          typeText,
          typeName: propsTypeName,
          destructuringPattern,
          isExported: true,
          isDefaultExport: true,
          bodyContent,
          isInlineType: isComplex,
          jsDocs,
          isAsync,
          start: stmt.start,
          end: stmt.end,
          isArrow: false,
        });
      }

      // Handle ExportNamedDeclaration containing FunctionDeclaration
      if (stmt.type === "ExportNamedDeclaration" && stmt.declaration?.type === "FunctionDeclaration") {
        const func = stmt.declaration;
        if (!func.id) continue;
        const componentName = func.id.name;
        if (!isReactComponent(componentName)) continue;

        const params = func.params || [];
        if (params.length !== 1) continue;

        const firstParam = params[0];
        const typeAnnotation = firstParam.typeAnnotation;
        if (!typeAnnotation) continue;

        const isComplex = isComplexType(typeAnnotation);
        if (!isComplex) {
          if (!hasObjectBindingPattern(firstParam)) continue;
          const props = getObjectPatternProperties(firstParam);
          if (props.length < 3 && !hasDefaultValues(firstParam)) continue;
        }

        const destructuringPattern = getDestructuringPatternText(firstParam, content);
        const typeText = typeAnnotation ? getNodeText(typeAnnotation.typeAnnotation, content) : "";
        const propsTypeName = `${componentName}Props`;

        const body = func.body;
        if (!body) continue;
        const bodyText = getNodeText(body, content);
        const bodyContent = bodyText.slice(1, -1).trim();

        const jsDocs = getLeadingComments(stmt, content);
        const isAsync = hasAsyncKeyword(func);

        allTransformations.push({
          componentName,
          typeText,
          typeName: propsTypeName,
          destructuringPattern,
          isExported: true,
          isDefaultExport: false,
          bodyContent,
          isInlineType: isComplex,
          jsDocs,
          isAsync,
          start: stmt.start,
          end: stmt.end,
          isArrow: false,
        });
      }

      // Handle plain FunctionDeclaration
      if (stmt.type === "FunctionDeclaration") {
        if (!stmt.id) continue;
        const componentName = stmt.id.name;
        if (!isReactComponent(componentName)) continue;

        const params = stmt.params || [];
        if (params.length !== 1) continue;

        const firstParam = params[0];
        const typeAnnotation = firstParam.typeAnnotation;
        if (!typeAnnotation) continue;

        const isComplex = isComplexType(typeAnnotation);
        if (!isComplex) {
          if (!hasObjectBindingPattern(firstParam)) continue;
          const props = getObjectPatternProperties(firstParam);
          if (props.length < 3 && !hasDefaultValues(firstParam)) continue;
        }

        const destructuringPattern = getDestructuringPatternText(firstParam, content);
        const typeText = typeAnnotation ? getNodeText(typeAnnotation.typeAnnotation, content) : "";
        const propsTypeName = `${componentName}Props`;

        const body = stmt.body;
        if (!body) continue;
        const bodyText = getNodeText(body, content);
        const bodyContent = bodyText.slice(1, -1).trim();

        const jsDocs = getLeadingComments(stmt, content);
        const isAsync = hasAsyncKeyword(stmt);

        allTransformations.push({
          componentName,
          typeText,
          typeName: propsTypeName,
          destructuringPattern,
          isExported: false,
          isDefaultExport: false,
          bodyContent,
          isInlineType: isComplex,
          jsDocs,
          isAsync,
          start: stmt.start,
          end: stmt.end,
          isArrow: false,
        });
      }
    }

    // Sort by position ascending
    allTransformations.sort((a, b) => a.start - b.start);

    // Build new source by processing from bottom to top
    let result = content;

    for (let i = allTransformations.length - 1; i >= 0; i--) {
      const t = allTransformations[i];
      const {
        componentName, typeText, typeName, destructuringPattern,
        isExported: tIsExported, isDefaultExport: tIsDefaultExport, bodyContent, isInlineType,
        jsDocs, isAsync, start: tStart, end: tEnd,
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

      const exportPrefix = tIsExported ? "export " : "";
      if (isInlineType) {
        lines.push(`${exportPrefix}type ${propsTypeName} = ${typeText};`);
        lines.push("");
      }

      let funcLine = "";
      if (tIsExported) funcLine += "export ";
      if (tIsDefaultExport) funcLine += "default ";
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
      result = result.slice(0, tStart) + lines.join("\n") + result.slice(tEnd);

      transformedCount++;
    }

    fs.writeFileSync(filePath, result, "utf-8");
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
