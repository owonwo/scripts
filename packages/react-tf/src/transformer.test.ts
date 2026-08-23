import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getSharedProject, isReactComponent, isTsxFile, transformComponents } from "./transformer";

describe("isReactComponent", () => {
  it("returns true for names starting with uppercase", () => {
    expect(isReactComponent("Box")).toMatchSnapshot();
    expect(isReactComponent("MyComponent")).toMatchSnapshot();
    expect(isReactComponent("App")).toMatchSnapshot();
  });

  it("returns false for names starting with lowercase", () => {
    expect(isReactComponent("box")).toMatchSnapshot();
    expect(isReactComponent("myComponent")).toMatchSnapshot();
    expect(isReactComponent("app")).toMatchSnapshot();
  });
});

describe("isTsxFile", () => {
  it("returns true for .tsx files", () => {
    expect(isTsxFile("Component.tsx")).toMatchSnapshot();
    expect(isTsxFile("/path/to/file.TSX")).toMatchSnapshot();
  });

  it("returns false for non-tsx files", () => {
    expect(isTsxFile("file.ts")).toMatchSnapshot();
    expect(isTsxFile("file.jsx")).toMatchSnapshot();
    expect(isTsxFile("file.js")).toMatchSnapshot();
  });
});

describe("transformComponents", () => {
  let tmpDir: string;

  beforeAll(() => {
    getSharedProject();
  });

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

  function expectResult(result: ReturnType<typeof transformComponents>) {
    return {
      toMatchSnapshot() {
        const { duration, filePath, ...rest } = result;
        expect(rest).toMatchSnapshot();
        expect(typeof duration).toBe("number");
        expect(duration).toBeLessThan(1000);
        expect(typeof filePath).toBe("string");
        expect(filePath.length).toBeGreaterThan(0);
        return this;
      },
    };
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

    expectResult(result).toMatchSnapshot();
    expect(output).toMatchSnapshot();
  });

  it("transforms arrow function with no props", () => {
    const input = `const SimpleComponent = () => {
  return <div>Hello World</div>
};`;

    const filePath = writeTestFile(input);
    const result = transformComponents(filePath);
    const output = readFile(filePath);

    expectResult(result).toMatchSnapshot();
    expect(output).toMatchSnapshot();
  });

  it("skips lowercase variables", () => {
    const input = `const notAComponent = "just a string";
const Box = () => {
  return <div>Hello</div>;
};`;

    const filePath = writeTestFile(input);
    const result = transformComponents(filePath);
    const output = readFile(filePath);

    expectResult(result).toMatchSnapshot();
    expect(output).toMatchSnapshot();
  });

  it("adds React import if missing", () => {
    const input = `const Box = () => {
  return <div>Hello</div>;
};`;

    const filePath = writeTestFile(input);
    const result = transformComponents(filePath);
    const output = readFile(filePath);

    expectResult(result).toMatchSnapshot();
    expect(output).toMatchSnapshot();
  });

  it("preserves existing React import", () => {
    const input = `import React from "react";

const Box = () => {
  return <div>Hello</div>;
};`;

    const filePath = writeTestFile(input);
    const result = transformComponents(filePath);
    const output = readFile(filePath);

    expectResult(result).toMatchSnapshot();
    const importCount = (output.match(/import React from "react"/g) || []).length;
    expect(importCount).toMatchSnapshot();
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

    expectResult(result).toMatchSnapshot();
    expect(output).toMatchSnapshot();
  });

  it("returns error for non-existent file", () => {
    const result = transformComponents("/non-existent/file.tsx");
    expectResult(result).toMatchSnapshot();
  });

  it("returns error for non-tsx file", () => {
    const filePath = path.join(tmpDir, "test.ts");
    fs.writeFileSync(filePath, "const x = 1;");
    const result = transformComponents(filePath);
    expectResult(result).toMatchSnapshot();
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

    expectResult(result).toMatchSnapshot();
    expect(output).toMatchSnapshot();
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

    expectResult(result).toMatchSnapshot();
    expect(output).toMatchSnapshot();
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

    expectResult(result).toMatchSnapshot();
    expect(output).toMatchSnapshot();
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

    expectResult(result).toMatchSnapshot();
    expect(output).toMatchSnapshot();
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

    expectResult(result).toMatchSnapshot();
    expect(output).toMatchSnapshot();
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

    expectResult(result).toMatchSnapshot();
    expect(output).toMatchSnapshot();
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

    expectResult(result).toMatchSnapshot();
    expect(output).toMatchSnapshot();
  });

  it("transforms exported function declaration with inline type and separate default export", () => {
    const input = `export function Do(props: { name: string }) {}

export default Do;`;

    const filePath = writeTestFile(input);
    const result = transformComponents(filePath);
    const output = readFile(filePath);

    expectResult(result).toMatchSnapshot();
    expect(output).toMatchSnapshot();
  });

  it("preserves export default keyword on function declaration with inline type", () => {
    const input = `export default function Widget({ label }: { label: string }) {
  return <div>{label}</div>;
}`;

    const filePath = writeTestFile(input);
    transformComponents(filePath);
    const output = readFile(filePath);

    expect(output).toContain("export default function Widget(props: WidgetProps");
  });

  it("preserves async and moves export default to end for arrow functions", () => {
    const input = `const DashboardLayout = async ({ children }: { children: React.ReactNode }) => {
  return ();
};

export default DashboardLayout;`;

    const filePath = writeTestFile(input);
    transformComponents(filePath);
    const output = readFile(filePath);

    expect(output).toContain("async function DashboardLayout(");
    const lines = output.trim().split("\n").filter(l => l.trim());
    expect(lines[lines.length - 1]).toBe("export default DashboardLayout;");
  });

  it("transforms arrow function with inline type and default values", () => {
    const input = `export const SegmentProgressBar = (props: {
  className?: string;
  progressValue?: number;
  gradient?: { startColor: string; endColor: string };
}) => {
  const {
    gradient = {
      startColor: "#ef4444",
      endColor: "#f97316",
    },
    progressValue = 0,
    className,
  } = props;
};`;

    const filePath = writeTestFile(input);
    const result = transformComponents(filePath);
    const output = readFile(filePath);

    expectResult(result).toMatchSnapshot();
    expect(output).toMatchSnapshot();
  });

  it("preserves JSDoc comment on function declaration with inline type", () => {
    const input = `/**
 * Shared media renderer — handles photo / video / pdf / empty states.
 * Used by the landing feed card, the dashboard favourites card, and the
 * shared project modal so all three stay visually consistent.
 */
export function MediaThumb({
  item,
  alt,
  className = "",
  videoRef,
  fill = false,
}: {
  item: MediaItem | null;
  alt: string;
  className?: string;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  fill?: boolean;
}) {
  return null;
}`;

    const filePath = writeTestFile(input);
    const result = transformComponents(filePath);
    const output = readFile(filePath);

    expectResult(result).toMatchSnapshot();
    expect(output).toMatchSnapshot();
  });

  it("preserves async keyword on function declaration", () => {
    const input = `export async function ResetPasswordHandler({
  token,
  password,
}: {
  token: string;
  password: string;
}) {
  await fetch("/api/reset", { method: "POST", body: JSON.stringify({ token, password }) });
}`;

    const filePath = writeTestFile(input);
    const result = transformComponents(filePath);
    const output = readFile(filePath);

    expectResult(result).toMatchSnapshot();
    expect(output).toMatchSnapshot();
  });

  it("does not produce const props = props when destructuring pattern is props", () => {
    const input = `const Foo = (props: {
  x: number;
  y: string;
}) => {
  return <div>{props.x} {props.y}</div>;
};`;

    const filePath = writeTestFile(input);
    const result = transformComponents(filePath);
    const output = readFile(filePath);

    expectResult(result).toMatchSnapshot();
    expect(output).toMatchSnapshot();
  });

  it("preserves order of multiple arrow functions", () => {
    const input = `const Alpha = ({ x }: { x: number }) => <div>{x}</div>;
const Beta = ({ y }: { y: string }) => <div>{y}</div>;`;

    const filePath = writeTestFile(input);
    transformComponents(filePath);
    const output = readFile(filePath);

    expect(output).toMatchSnapshot();
  });

  it("preserves type alias before function declaration", () => {
    const input = `function Foo({
  value
}: {
  value: string
}) {
  return <div>{value}</div>;
}`;

    const filePath = writeTestFile(input);
    transformComponents(filePath);
    const output = readFile(filePath);

    expect(output).toMatchSnapshot();
  });

  it("preserves formatting across multiple function declarations", () => {
    const input = `function A() {
  return <div>A</div>;
}

function B({
  value
}: {
  value: string
}) {
  return <div>{value}</div>;
}

export function C({
  x
}: {
  x: number
}) {
  return <div>{x}</div>;
}`;

    const filePath = writeTestFile(input);
    transformComponents(filePath);
    const output = readFile(filePath);

    expect(output).toMatchSnapshot();
  });

  it("preserves destructuring order before body content", () => {
    const input = `function Foo({
  a,
  b,
  c
}: {
  a: string;
  b: number;
  c: boolean;
}) {
  return null;
}`;

    const filePath = writeTestFile(input);
    transformComponents(filePath);
    const output = readFile(filePath);

    expect(output).toMatchSnapshot();
  });

  it("transforms async arrow function with children prop", () => {
    const input = `import { BrandLogo } from "~/components/layouts/header";
import { AuthUserAvatar } from "~/components/profile/auth-user-avatar";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Sidebar } from "./_components/sidebar";

const DashboardLayout = async ({ children }: { children: React.ReactNode }) => {
  return (
    "Hi"
  );
};

export default DashboardLayout;`;

    const filePath = writeTestFile(input);
    transformComponents(filePath);
    const output = readFile(filePath);

    expect(output).toMatchInlineSnapshot(`
      "import { BrandLogo } from "~/components/layouts/header";
      import { AuthUserAvatar } from "~/components/profile/auth-user-avatar";
      import { ScrollArea } from "~/components/ui/scroll-area";
      import { Sidebar } from "./_components/sidebar";
      type DashboardLayoutProps = { children: React.ReactNode };

      async function DashboardLayout(props: DashboardLayoutProps) {

            const { children } = props;

            return (
              "Hi"
            );
      }

      export default DashboardLayout;"
    `);
  });
});
