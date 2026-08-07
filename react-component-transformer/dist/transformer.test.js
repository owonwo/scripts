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
    let tmpDir;
    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "transformer-test-"));
    });
    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });
    function writeTestFile(content) {
        const filePath = path.join(tmpDir, "test.tsx");
        fs.writeFileSync(filePath, content);
        return filePath;
    }
    function readFile(filePath) {
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
    "import React from "react";
    type BoxProps = {
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
    "import React from "react";

    function SimpleComponent() {
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
    "import React from "react";

    const notAComponent = "just a string";

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
    "import React from "react";

    function Box() {
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
    "import React from "react";
    export type BoxProps = {
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
});
