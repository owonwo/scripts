import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isReactComponent, isTsxFile, transformComponents } from "./transformer";

describe("isReactComponent", () => {
  it("returns true for names starting with uppercase", () => {
    expect(isReactComponent("Box")).toBe(true);
    expect(isReactComponent("MyComponent")).toBe(true);
    expect(isReactComponent("App")).toBe(true);
  });

  it("returns false for names starting with lowercase", () => {
    expect(isReactComponent("box")).toBe(false);
    expect(isReactComponent("myComponent")).toBe(false);
    expect(isReactComponent("app")).toBe(false);
  });
});

describe("isTsxFile", () => {
  it("returns true for .tsx files", () => {
    expect(isTsxFile("Component.tsx")).toBe(true);
    expect(isTsxFile("/path/to/file.TSX")).toBe(true);
  });

  it("returns false for non-tsx files", () => {
    expect(isTsxFile("file.ts")).toBe(false);
    expect(isTsxFile("file.jsx")).toBe(false);
    expect(isTsxFile("file.js")).toBe(false);
  });
});

describe("transformComponents", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "transformer-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeTestFile(content: string): string {
    const filePath = path.join(tmpDir, "test.tsx");
    fs.writeFileSync(filePath, content);
    return filePath;
  }

  function readFile(filePath: string): string {
    return fs.readFileSync(filePath, "utf-8");
  }

  it("transforms arrow function with props to function declaration", () => {
    const input = `const Box = ({
  boxes,
  count
}: {
  boxes: number,
  count: string
}) => {
  return (
    <div>
      {boxes} - {count}
    </div>
  );
};`;

    const filePath = writeTestFile(input);
    const result = transformComponents(filePath);
    const output = readFile(filePath);

    expect(result.success).toBe(true);
    expect(result.componentsFound).toBe(1);
    expect(output).toMatchInlineSnapshot(`
    "type BoxProps = {
          boxes: number,
          count: string
        };

    function Box(props: BoxProps) {

          const {
          boxes,
          count
        } = props;

          return (
            <div>
              {boxes} - {count}
            </div>
          );
    }
    "
    `);
  });

  it("transforms arrow function with no props", () => {
    const input = `const SimpleComponent = () => {
  return <div>Hello World</div>
};`;

    const filePath = writeTestFile(input);
    const result = transformComponents(filePath);
    const output = readFile(filePath);

    expect(result.success).toBe(true);
    expect(result.componentsFound).toBe(1);
    expect(output).toMatchInlineSnapshot(`
    "function SimpleComponent() {
    }
    "
    `);
  });

  it("skips lowercase variables", () => {
    const input = `const notAComponent = "just a string";
const Box = () => {
  return <div>Hello</div>;
};`;

    const filePath = writeTestFile(input);
    const result = transformComponents(filePath);
    const output = readFile(filePath);

    expect(result.success).toBe(true);
    expect(result.componentsFound).toBe(1);
    expect(output).toMatchInlineSnapshot(`
    "const notAComponent = "just a string";

    function Box() {
    }
    "
    `);
  });

  it("adds React import if missing", () => {
    const input = `const Box = () => {
  return <div>Hello</div>;
};`;

    const filePath = writeTestFile(input);
    const result = transformComponents(filePath);
    const output = readFile(filePath);

    expect(result.success).toBe(true);
    expect(output).toMatchInlineSnapshot(`
    "function Box() {
    }
    "
    `);
  });

  it("preserves existing React import", () => {
    const input = `import React from "react";

const Box = () => {
  return <div>Hello</div>;
};`;

    const filePath = writeTestFile(input);
    const result = transformComponents(filePath);
    const output = readFile(filePath);

    expect(result.success).toBe(true);
    const importCount = (output.match(/import React from "react"/g) || []).length;
    expect(importCount).toBe(1);
  });

  it("handles exported components", () => {
    const input = `export const Box = ({
  value
}: {
  value: string
}) => {
  return <div>{value}</div>;
};`;

    const filePath = writeTestFile(input);
    const result = transformComponents(filePath);
    const output = readFile(filePath);

    expect(result.success).toBe(true);
    expect(result.componentsFound).toBe(1);
    expect(output).toMatchInlineSnapshot(`
    "export type BoxProps = {
          value: string
        };

    export function Box(props: BoxProps) {

          const {
          value
        } = props;

          return <div>{value}</div>;
    }
    "
    `);
  });

  it("returns error for non-existent file", () => {
    const result = transformComponents("/non-existent/file.tsx");
    expect(result.success).toBe(false);
    expect(result.message).toBe("File not found");
  });

  it("returns error for non-tsx file", () => {
    const filePath = path.join(tmpDir, "test.ts");
    fs.writeFileSync(filePath, "const x = 1;");
    const result = transformComponents(filePath);
    expect(result.success).toBe(false);
    expect(result.message).toBe("Not a TSX file");
  });

  it("renames ...props to ...restProps to avoid naming conflict", () => {
    const input = `const Avatar = ({
  size = 80,
  disabled,
  className,
  ...props
}: {
  size?: number;
  disabled?: boolean;
  className?: string;
  [key: string]: any;
}) => {
  return <div {...props} className={className} />;
};`;

    const filePath = writeTestFile(input);
    const result = transformComponents(filePath);
    const output = readFile(filePath);

    expect(result.success).toBe(true);
    expect(result.componentsFound).toBe(1);
    expect(output).toContain("...restProps");
    expect(output).not.toContain("...props");
  });

  it("renames ...props to ...restProps in function declaration with named type", () => {
    const input = `interface AvatarProps {
  size?: number;
  disabled?: boolean;
  className?: string;
  [key: string]: any;
}

function Avatar({
  size = 80,
  disabled,
  className,
  ...props
}: AvatarProps) {
  return <div {...props} className={className} />;
}`;

    const filePath = writeTestFile(input);
    const result = transformComponents(filePath);
    const output = readFile(filePath);

    expect(result.success).toBe(true);
    expect(result.componentsFound).toBe(1);
    expect(output).toContain("...restProps");
    expect(output).not.toContain("...props");
  });

  it("preserves export default on function declaration with inline type", () => {
    const input = `export default function Box({
  value
}: {
  value: string
}) {
  return <div>{value}</div>;
}`;

    const filePath = writeTestFile(input);
    const result = transformComponents(filePath);
    const output = readFile(filePath);

    expect(result.success).toBe(true);
    expect(result.componentsFound).toBe(1);
    expect(output).toContain("export default function Box");
    expect(output).not.toMatch(/export function Box\b/);
  });

  it("preserves export default on function declaration with named type", () => {
    const input = `interface BoxProps {
  value: string;
  label: string;
  disabled: boolean;
}

export default function Box({
  value,
  label,
  disabled
}: BoxProps) {
  return <div>{value}</div>;
}`;

    const filePath = writeTestFile(input);
    const result = transformComponents(filePath);
    const output = readFile(filePath);

    expect(result.success).toBe(true);
    expect(result.componentsFound).toBe(1);
    expect(output).toContain("export default function Box");
    expect(output).not.toMatch(/export function Box\b/);
  });

  it("handles named export (non-default) function declaration", () => {
    const input = `export function Box({
  value
}: {
  value: string
}) {
  return <div>{value}</div>;
}`;

    const filePath = writeTestFile(input);
    const result = transformComponents(filePath);
    const output = readFile(filePath);

    expect(result.success).toBe(true);
    expect(result.componentsFound).toBe(1);
    expect(output).toContain("export function Box");
    expect(output).not.toContain("export default");
  });

  it("handles non-exported function declaration", () => {
    const input = `function Box({
  value
}: {
  value: string
}) {
  return <div>{value}</div>;
}`;

    const filePath = writeTestFile(input);
    const result = transformComponents(filePath);
    const output = readFile(filePath);

    expect(result.success).toBe(true);
    expect(result.componentsFound).toBe(1);
    expect(output).toMatch(/^function Box/m);
    expect(output).not.toContain("export");
  });

  it("transforms function declaration with inline type literal and 3+ props", () => {
    const input = `function TimerUI(props: {
  className?: string;
  mode: "expiring" | "expired" | "running";
  value: ReturnType<typeof formatElapsed>;
}) {
  return null
}`;

    const filePath = writeTestFile(input);
    const result = transformComponents(filePath);
    const output = readFile(filePath);

    expect(result.success).toBe(true);
    expect(result.componentsFound).toBe(1);
    expect(output).toContain("type TimerUIProps =");
    expect(output).toContain("function TimerUI(props: TimerUIProps)");
    expect(output).not.toContain("export");
  });
});
