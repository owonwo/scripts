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
  if (type.type === "TSTypeReference") return false;
  return true;
}

interface AstNode {
  type: string;
  start: number;
  end: number;
  [key: string]: any;
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

function getLeadingCommentStart(node: AstNode, source: string): number {
  let pos = node.start;
  while (pos > 0) {
    const ch = source[pos - 1];
    if (ch === "\n" || ch === "\r" || ch === " " || ch === "\t") {
      pos--;
      continue;
    }
    if (source.slice(pos - 2, pos) === "*/") {
      pos -= 2;
      while (pos > 0 && source.slice(pos - 2, pos) !== "/*") pos--;
      return pos - 2;
    }
    break;
  }
  return node.start;
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
      const start = pos - 2;
      comments.unshift(source.slice(start, end).trim());
      pos = start;
      continue;
    }
    break;
  }
  return comments;
}

function getDestructuringPatternName(param: AstNode, source: string): string {
  if (param.type === "Identifier") {
    return param.name || source.slice(param.start, param.end);
  }
  if (param.type === "ObjectPattern") {
    const end = param.typeAnnotation ? param.typeAnnotation.start : param.end;
    return source.slice(param.start, end);
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

    // Collect and remove separate `export default X;` statement
    let defaultExportName: string | null = null;
    const exportAssignments = statements.filter(
      (s) => s.type === "ExportDefaultDeclaration" && s.declaration?.type === "Identifier",
    );
    for (const ea of exportAssignments) {
      defaultExportName = ea.declaration.name;
    }


    // Collect all transformations
    const allTransformations: Array<{
      componentName: string;
      typeText: string;
      typeName: string;
      destructuringPattern: string;
      hasDestructuring: boolean;
      isExported: boolean;
      isDefaultExport: boolean;
      bodyContent: string;
      isInlineType: boolean;
      jsDocs: string[];
      isAsync: boolean;
      hasBlockBody: boolean;
      start: number;
      end: number;
      rawComment: string;
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
          const hasBlockBody = body.type === "BlockStatement";
          const bodyContent = hasBlockBody
            ? bodyText.slice(1, -1).trim()
            : bodyText.trim();

          const parentIsExport = isExported(stmt);
          const parentIsDefault = isDefaultExport(stmt);
          const isAsync = hasAsyncKeyword(arrowFunc);

          if (params.length === 0) {
            // No-props arrow: just convert syntax, no const line needed
            allTransformations.push({
              componentName,
              typeText: "",
              typeName: "",
              destructuringPattern: "",
              hasDestructuring: false,
              isExported: parentIsExport,
              isDefaultExport: parentIsDefault,
              bodyContent,
              isInlineType: false,
              jsDocs: [],
              isAsync,
              hasBlockBody,
              start: stmt.start,
              end: stmt.end,
              rawComment: "",
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

            const destructuringPattern = getDestructuringPatternName(firstParam, content);
            const typeText = typeAnnotation ? getNodeText(typeAnnotation.typeAnnotation, content) : "";
            const propsTypeName = `${componentName}Props`;
            const hasDestructuring = destructuringPattern !== "props";

            allTransformations.push({
              componentName,
              typeText,
              typeName: propsTypeName,
              destructuringPattern,
              hasDestructuring,
              isExported: parentIsExport,
              isDefaultExport: parentIsDefault,
              bodyContent,
              isInlineType: isComplex,
              jsDocs: [],
              isAsync,
              hasBlockBody,
              start: stmt.start,
              end: stmt.end,
              rawComment: "",
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
          const hasBlockBody = body.type === "BlockStatement";
          const bodyContent = hasBlockBody
            ? bodyText.slice(1, -1).trim()
            : bodyText.trim();
          const isAsync = hasAsyncKeyword(arrowFunc);

          if (params.length === 0) {
            allTransformations.push({
              componentName,
              typeText: "",
              typeName: "",
              destructuringPattern: "",
              hasDestructuring: false,
              isExported: true,
              isDefaultExport: false,
              bodyContent,
              isInlineType: false,
              jsDocs: [],
              isAsync,
              hasBlockBody,
              start: stmt.start,
              end: stmt.end,
              rawComment: "",
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

            const destructuringPattern = getDestructuringPatternName(firstParam, content);
            const typeText = typeAnnotation ? getNodeText(typeAnnotation.typeAnnotation, content) : "";
            const propsTypeName = `${componentName}Props`;
            const hasDestructuring = destructuringPattern !== "props";

            allTransformations.push({
              componentName,
              typeText,
              typeName: propsTypeName,
              destructuringPattern,
              hasDestructuring,
              isExported: true,
              isDefaultExport: false,
              bodyContent,
              isInlineType: isComplex,
              jsDocs: [],
              isAsync,
              hasBlockBody,
              start: stmt.start,
              end: stmt.end,
              rawComment: "",
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

        const destructuringPattern = getDestructuringPatternName(firstParam, content);
        const typeText = typeAnnotation ? getNodeText(typeAnnotation.typeAnnotation, content) : "";
        const propsTypeName = `${componentName}Props`;
        const hasDestructuring = destructuringPattern !== "props";

        const body = func.body;
        if (!body) continue;
        const bodyText = getNodeText(body, content);
        const bodyContent = bodyText.slice(1, -1).trim();

        const jsDocs = getLeadingComments(stmt, content);
        const isAsync = hasAsyncKeyword(func);
        const commentStart = getLeadingCommentStart(stmt, content);
        const rawComment = content.slice(commentStart, stmt.start);

        allTransformations.push({
          componentName,
          typeText,
          typeName: propsTypeName,
          destructuringPattern,
          hasDestructuring,
          isExported: true,
          isDefaultExport: true,
          bodyContent,
          isInlineType: isComplex,
          jsDocs,
          isAsync,
          hasBlockBody: true,
          start: commentStart,
          end: stmt.end,
          rawComment,
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

        const destructuringPattern = getDestructuringPatternName(firstParam, content);
        const typeText = typeAnnotation ? getNodeText(typeAnnotation.typeAnnotation, content) : "";
        const propsTypeName = `${componentName}Props`;
        const hasDestructuring = destructuringPattern !== "props";

        const body = func.body;
        if (!body) continue;
        const bodyText = getNodeText(body, content);
        const bodyContent = bodyText.slice(1, -1).trim();

        const jsDocs = getLeadingComments(stmt, content);
        const isAsync = hasAsyncKeyword(func);
        const commentStart = getLeadingCommentStart(stmt, content);
        const rawComment = content.slice(commentStart, stmt.start);

        allTransformations.push({
          componentName,
          typeText,
          typeName: propsTypeName,
          destructuringPattern,
          hasDestructuring,
          isExported: true,
          isDefaultExport: false,
          bodyContent,
          isInlineType: isComplex,
          jsDocs,
          isAsync,
          hasBlockBody: true,
          start: commentStart,
          end: stmt.end,
          rawComment,
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

        const destructuringPattern = getDestructuringPatternName(firstParam, content);
        const typeText = typeAnnotation ? getNodeText(typeAnnotation.typeAnnotation, content) : "";
        const propsTypeName = `${componentName}Props`;
        const hasDestructuring = destructuringPattern !== "props";

        const body = stmt.body;
        if (!body) continue;
        const bodyText = getNodeText(body, content);
        const bodyContent = bodyText.slice(1, -1).trim();

        const jsDocs = getLeadingComments(stmt, content);
        const isAsync = hasAsyncKeyword(stmt);
        const commentStart = getLeadingCommentStart(stmt, content);
        const rawComment = content.slice(commentStart, stmt.start);

        allTransformations.push({
          componentName,
          typeText,
          typeName: propsTypeName,
          destructuringPattern,
          hasDestructuring,
          isExported: false,
          isDefaultExport: false,
          bodyContent,
          isInlineType: isComplex,
          jsDocs,
          isAsync,
          hasBlockBody: true,
          start: commentStart,
          end: stmt.end,
          rawComment,
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
        componentName, typeText, typeName, destructuringPattern, hasDestructuring,
        isExported: tIsExported, isDefaultExport: tIsDefaultExport, bodyContent, isInlineType,
        jsDocs, isAsync, hasBlockBody, start: tStart, end: tEnd, rawComment,
      } = t;

      const propsTypeName = typeName || `${componentName}Props`;
      const lines: string[] = [];

      // Re-emit original comment if present
      if (rawComment) {
        lines.push(rawComment.trimEnd());
        lines.push("");
      }

      // Type alias first
      const exportPrefix = tIsExported ? "export " : "";
      if (isInlineType) {
        lines.push(`${exportPrefix}type ${propsTypeName} = ${typeText};`);
        lines.push("");
      }

      // Function signature — no-props gets empty params
      let funcLine = "";
      if (tIsExported) funcLine += "export ";
      if (tIsDefaultExport) funcLine += "default ";
      if (isAsync) funcLine += "async ";
      if (hasDestructuring || typeName) {
        funcLine += `function ${componentName}(props: ${propsTypeName}) {`;
      } else {
        funcLine += `function ${componentName}() {`;
      }
      lines.push(funcLine);

      const bodyPrefix = hasBlockBody ? "" : "return ";

      if (hasDestructuring) {
        const fixedPattern = destructuringPattern.replace(/\.\.\.props\b/g, "...restProps");
        const fixedBodyContent =
          fixedPattern !== destructuringPattern
            ? bodyContent.replace(/\.\.\.props\b/g, "...restProps")
            : bodyContent;
        lines.push(`  const ${fixedPattern} = props;`);
        lines.push("");
        lines.push(`  ${bodyPrefix}${fixedBodyContent}`);
      } else {
        lines.push(`  ${bodyPrefix}${bodyContent}`);
      }

      lines.push("}");

      // Replace the original range [start, end) with the new text
      result = result.slice(0, tStart) + lines.join("\n") + result.slice(tEnd);

      transformedCount++;
    }

    // Remove standalone `export default X;` statements from the modified result
    // (can't use AST positions since the main transformation changed string offsets)
    if (defaultExportName) {
      const marker = `export default ${defaultExportName};`;
      let idx = result.indexOf(marker);
      while (idx !== -1) {
        result = result.slice(0, idx) + result.slice(idx + marker.length);
        idx = result.indexOf(marker);
      }
    }

    // Re-append separate export default statement at the end
    if (defaultExportName) {
      result += `\nexport default ${defaultExportName};`;
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
