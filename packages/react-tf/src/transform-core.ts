import { SyntaxKind, type SourceFile } from "ts-morph";

export function isReactComponent(name: string): boolean {
  return /^[A-Z]/.test(name);
}

function isComplexType(typeNode: any): boolean {
  const kind = typeNode.getKind();
  if (kind === SyntaxKind.TypeReference || kind === SyntaxKind.QualifiedName) return false;
  return true;
}

export interface Transformation {
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
  start: number;
  end: number;
  rawComment: string;
  hasBlockBody: boolean;
}

export function collectTransformations(sourceFile: SourceFile): Transformation[] {
  const content = sourceFile.getFullText();
  const transformations: Transformation[] = [];

  const variableStatements = sourceFile.getStatements().filter((s) =>
    s.isKind(SyntaxKind.VariableStatement)
  );

  for (const statement of variableStatements) {
    const vs = statement.asKindOrThrow(SyntaxKind.VariableStatement);
    for (const decl of vs.getDeclarationList().getDeclarations()) {
      const name = decl.getName();
      if (!isReactComponent(name)) continue;

      const init = decl.getInitializer();
      if (!init || !init.isKind(SyntaxKind.ArrowFunction)) continue;

      const arrow = init.asKindOrThrow(SyntaxKind.ArrowFunction);
      const params = arrow.getParameters();
      if (params.length > 1) continue;

      const body = arrow.getBody();
      if (!body) continue;
      const bodyText = body.getText();
      const bodyContent = bodyText.slice(1, -1).trim();
      const hasBlockBody = bodyText.startsWith("{");

      if (params.length === 0) {
        transformations.push({
          componentName: name,
          typeText: "",
          typeName: "",
          destructuringPattern: "",
          hasDestructuring: false,
          isExported: vs.isExported(),
          isDefaultExport: vs.isDefaultExport(),
          bodyContent,
          isInlineType: false,
          isAsync: arrow.isAsync(),
          jsDocs: [],
          start: statement.getFullStart(),
          end: statement.getEnd(),
          rawComment: "",
          hasBlockBody,
        });
      } else {
        const param = params[0];
        const typeNode = param.getTypeNode();
        if (!typeNode) continue;

        const isComplex = isComplexType(typeNode);
        if (!isComplex) continue;

        const destructuringPattern = param.getName();
        const propsTypeName = `${name}Props`;

        transformations.push({
          componentName: name,
          typeText: typeNode.getText(),
          typeName: propsTypeName,
          destructuringPattern,
          hasDestructuring: destructuringPattern !== "props",
          isExported: vs.isExported(),
          isDefaultExport: vs.isDefaultExport(),
          bodyContent,
          isInlineType: true,
          isAsync: arrow.isAsync(),
          jsDocs: [],
          start: statement.getFullStart(),
          end: statement.getEnd(),
          rawComment: "",
          hasBlockBody,
        });
      }
    }
  }

  const functions = sourceFile.getFunctions().filter((f) => {
    const n = f.getName();
    return n && isReactComponent(n);
  });

  for (const func of functions) {
    const params = func.getParameters();
    if (params.length !== 1) continue;

    const param = params[0];
    const typeNode = param.getTypeNode();
    if (!typeNode) continue;

    const name = func.getName()!;
    const destructuringPattern = param.getName();
    const isExported = func.getModifiers().some((m) => m.getKind() === SyntaxKind.ExportKeyword);
    const isDefaultExport = func.getModifiers().some((m) => m.getKind() === SyntaxKind.DefaultKeyword);

    const body = func.getBody();
    if (!body) continue;
    const bodyContent = body.getText().slice(1, -1).trim();

    const jsDocs = func.getJsDocs().map((d) => d.getCommentText() ?? "");
    const isAsync = func.isAsync();

    const start = func.getFullStart();
    const end = func.getEnd();

    if (isComplexType(typeNode)) {
      transformations.push({
        componentName: name,
        typeText: typeNode.getText(),
        typeName: `${name}Props`,
        destructuringPattern,
        hasDestructuring: destructuringPattern !== "props",
        isExported,
        isDefaultExport,
        bodyContent,
        isInlineType: true,
        isAsync,
        jsDocs,
        start,
        end,
        rawComment: "",
        hasBlockBody: true,
      });
    } else {
      if (param.getNameNode().getKind() !== SyntaxKind.ObjectBindingPattern) continue;

      const objectPattern = param.getNameNode().asKindOrThrow(SyntaxKind.ObjectBindingPattern);
      const properties = objectPattern.getElements();
      const hasThreeOrMoreProps = properties.length >= 3;
      const hasDefaultValues = properties.some((p: any) => p.getInitializer() !== undefined);

      if (!hasThreeOrMoreProps && !hasDefaultValues) continue;

      transformations.push({
        componentName: name,
        typeText: "",
        typeName: typeNode.getText(),
        destructuringPattern,
        hasDestructuring: destructuringPattern !== "props",
        isExported,
        isDefaultExport,
        bodyContent,
        isInlineType: false,
        isAsync,
        jsDocs,
        start,
        end,
        rawComment: "",
        hasBlockBody: true,
      });
    }
  }

  return transformations;
}

export function buildTransformedSource(
  srcText: string,
  transformations: Transformation[],
): string {
  transformations.sort((a, b) => a.start - b.start);

  let result = srcText;

  for (let i = transformations.length - 1; i >= 0; i--) {
    const t = transformations[i];
    const {
      componentName, typeText, typeName, destructuringPattern, hasDestructuring,
      isExported, isDefaultExport, bodyContent, isInlineType,
      jsDocs, isAsync, start, end, hasBlockBody,
    } = t;

    const propsTypeName = typeName || `${componentName}Props`;
    const lines: string[] = [];

    if (isInlineType) {
      const exportPrefix = isExported ? "export " : "";
      lines.push(`${exportPrefix}type ${propsTypeName} = ${typeText};`);
    }

    if (jsDocs.length > 0) {
      lines.push("/**");
      for (const line of jsDocs) {
        for (const l of line.split("\n")) {
          lines.push(` * ${l.trim()}`);
        }
      }
      lines.push(" */");
    }

    let funcLine = "";
    if (isExported) funcLine += "export ";
    if (isDefaultExport) funcLine += "default ";
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

    result = result.slice(0, start) + lines.join("\n") + result.slice(end);
  }

  return result;
}
