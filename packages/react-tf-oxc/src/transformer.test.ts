import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isReactComponent, isTsxFile, transformComponents } from "./transformer";

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

  function expectResult(result: Awaited<ReturnType<typeof transformComponents>>) {
    return {
      toMatchSnapshot() {
        const { duration, filePath, ...rest } = result;
        expect(rest).toMatchSnapshot();
        expect(typeof duration).toBe("number");
        expect(duration).toBeLessThan(20);
        expect(typeof filePath).toBe("string");
        expect(filePath.length).toBeGreaterThan(0);
        return this;
      },
    };
  }

  async function assertIdempotent(input: string, iterations: number = 4): Promise<void> {
    const outputs: string[] = [];
    let currentInput = input;

    for (let i = 0; i < iterations; i++) {
      const filePath = writeTestFile(currentInput);
      await transformComponents(filePath);
      const output = readFile(filePath);
      outputs.push(output);
      currentInput = output;
    }

    const divergences: number[] = [];
    for (let i = 1; i < outputs.length; i++) {
      if (outputs[i] !== outputs[0]) {
        divergences.push(i + 1);
      }
    }

    if (divergences.length > 0) {
      throw new Error(
        `Transformer is not idempotent. ` +
        `${divergences.length} divergence(s) found at iterations: ${divergences.join(", ")}`
      );
    }
  }

  it("transforms arrow function with props to function declaration", async () => {
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
    const result = await transformComponents(filePath);
    const output = readFile(filePath);

    expectResult(result).toMatchSnapshot();
    expect(output).toMatchSnapshot();
    await assertIdempotent(input);
  });

  it("transforms arrow function with no props", async () => {
    const input = `const SimpleComponent = () => {
  return <div>Hello World</div>
};`;

    const filePath = writeTestFile(input);
    const result = await transformComponents(filePath);
    const output = readFile(filePath);

    expectResult(result).toMatchSnapshot();
    expect(output).toMatchSnapshot();
    await assertIdempotent(input);
  });

  it("skips lowercase variables", async () => {
    const input = `const notAComponent = "just a string";
const Box = () => {
  return <div>Hello</div>;
};`;

    const filePath = writeTestFile(input);
    const result = await transformComponents(filePath);
    const output = readFile(filePath);

    expectResult(result).toMatchSnapshot();
    expect(output).toMatchSnapshot();
    await assertIdempotent(input);
  });

  it("does not add export when function is exported via separate statement", async () => {
    const input = `function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={className} {...props} />;
}

export { Badge };`;

    const filePath = writeTestFile(input);
    const result = await transformComponents(filePath);
    const output = readFile(filePath);

    expect(output).toContain("function Badge(");
    expect(output).not.toMatch(/^export function Badge/m);
    expect(output).toContain("export { Badge }");
    await assertIdempotent(input);
  });

  it("transforms arrow function with inline type and parentheses body", async () => {
    const input = `const WorkItem = ({
  position,
  company,
  timeline,
}: {
  position: string;
  company: string;
  timeline: string;
}) => (
  <div className="flex justify-between text-sm">
    <div>
      <p className="font-medium text-white">{position}</p>
      <p className="text-white/60">{company}</p>
    </div>
    <p className="text-white/50">{timeline}</p>
  </div>
);

export default WorkItem;`;

    const filePath = writeTestFile(input);
    const result = await transformComponents(filePath);
    const output = readFile(filePath);

    expectResult(result).toMatchSnapshot();
    expect(output).toMatchSnapshot();
    await assertIdempotent(input);
  });

  it("transforms expression body arrow function", async () => {
    const input = `const Title = () => <span>Dashboard</span>;
export { Title };`;

    const filePath = writeTestFile(input);
    const result = await transformComponents(filePath);
    const output = readFile(filePath);

    expectResult(result).toMatchSnapshot();
    expect(output).toMatchInlineSnapshot(`
"function Title() {
  return <span>Dashboard</span>
}
export { Title };"
`);
    await assertIdempotent(input);
  });

  it("transforms expression body arrow function with props", async () => {
    const input = `const Badge = ({ label }: { label: string }) => <span>{label}</span>;
export { Badge };`;

    const filePath = writeTestFile(input);
    const result = await transformComponents(filePath);
    const output = readFile(filePath);

    expectResult(result).toMatchSnapshot();
    expect(output).toMatchInlineSnapshot(`
      "type BadgeProps = { label: string };

      function Badge(props: BadgeProps) {
        const { label } = props;

        return <span>{label}</span>
      }
      export { Badge };"
    `);
    await assertIdempotent(input);
  });

  it("adds React import if missing", async () => {
    const input = `const Box = () => {
  return <div>Hello</div>;
};`;

    const filePath = writeTestFile(input);
    const result = await transformComponents(filePath);
    const output = readFile(filePath);

    expectResult(result).toMatchSnapshot();
    expect(output).toMatchSnapshot();
    await assertIdempotent(input);
  });

  it("preserves existing React import", async () => {
    const input = `import React from "react";

const Box = () => {
  return <div>Hello</div>;
};`;

    const filePath = writeTestFile(input);
    const result = await transformComponents(filePath);
    const output = readFile(filePath);

    expectResult(result).toMatchSnapshot();
    const importCount = (output.match(/import React from "react"/g) || []).length;
    expect(importCount).toMatchSnapshot();
    await assertIdempotent(input);
  });

  it("handles exported components", async () => {
    const input = `export const Box = ({
  value
}: {
  value: string
}) => {
  return <div>{value}</div>;
};`;

    const filePath = writeTestFile(input);
    const result = await transformComponents(filePath);
    const output = readFile(filePath);

    expectResult(result).toMatchSnapshot();
    expect(output).toMatchSnapshot();
    await assertIdempotent(input);
  });

  it("returns error for non-existent file", async () => {
    const result = await transformComponents("/non-existent/file.tsx");
    expectResult(result).toMatchSnapshot();
  });

  it("returns error for non-tsx file", async () => {
    const filePath = path.join(tmpDir, "test.ts");
    fs.writeFileSync(filePath, "const x = 1;");
    const result = await transformComponents(filePath);
    expectResult(result).toMatchSnapshot();
  });

  it("renames ...props to ...restProps to avoid naming conflict", async () => {
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
    const result = await transformComponents(filePath);
    const output = readFile(filePath);

    expectResult(result).toMatchSnapshot();
    expect(output).toMatchSnapshot();
    await assertIdempotent(input);
  });

  it("renames ...props to ...restProps in function declaration with named type", async () => {
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
    const result = await transformComponents(filePath);
    const output = readFile(filePath);

    expectResult(result).toMatchSnapshot();
    expect(output).toMatchSnapshot();
    await assertIdempotent(input);
  });

  it("preserves export default on function declaration with inline type", async () => {
    const input = `export default function Box({
  value
}: {
  value: string
}) {
  return <div>{value}</div>;
}`;

    const filePath = writeTestFile(input);
    const result = await transformComponents(filePath);
    const output = readFile(filePath);

    expectResult(result).toMatchSnapshot();
    expect(output).toMatchSnapshot();
    await assertIdempotent(input);
  });

  it("preserves export default on function declaration with named type", async () => {
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
    const result = await transformComponents(filePath);
    const output = readFile(filePath);

    expectResult(result).toMatchSnapshot();
    expect(output).toMatchSnapshot();
    await assertIdempotent(input);
  });

  it("handles named export (non-default) function declaration", async () => {
    const input = `export function Box({
  value
}: {
  value: string
}) {
  return <div>{value}</div>;
}`;

    const filePath = writeTestFile(input);
    const result = await transformComponents(filePath);
    const output = readFile(filePath);

    expectResult(result).toMatchSnapshot();
    expect(output).toMatchSnapshot();
    await assertIdempotent(input);
  });

  it("handles non-exported function declaration", async () => {
    const input = `function Box({
  value
}: {
  value: string
}) {
  return <div>{value}</div>;
}`;

    const filePath = writeTestFile(input);
    const result = await transformComponents(filePath);
    const output = readFile(filePath);

    expectResult(result).toMatchSnapshot();
    expect(output).toMatchSnapshot();
    await assertIdempotent(input);
  });

  it("transforms function declaration with inline type literal and 3+ props", async () => {
    const input = `function TimerUI(props: {
  className?: string;
  mode: "expiring" | "expired" | "running";
  value: ReturnType<typeof formatElapsed>;
}) {
  return null
}`;

    const filePath = writeTestFile(input);
    const result = await transformComponents(filePath);
    const output = readFile(filePath);

    expectResult(result).toMatchSnapshot();
    expect(output).toMatchSnapshot();
    await assertIdempotent(input);
  });

  it("transforms exported function declaration with inline type and separate default export", async () => {
    const input = `export function Do(props: { name: string }) {}

export default Do;`;

    const filePath = writeTestFile(input);
    const result = await transformComponents(filePath);
    const output = readFile(filePath);

    expectResult(result).toMatchSnapshot();
    expect(output).toMatchSnapshot();
    await assertIdempotent(input);
  });

  it("preserves export default keyword on function declaration with inline type", async () => {
    const input = `export default function Widget({ label }: { label: string }) {
  return <div>{label}</div>;
}`;

    const filePath = writeTestFile(input);
    await transformComponents(filePath);
    const output = readFile(filePath);

    expect(output).toContain("export default function Widget(props: WidgetProps");
    await assertIdempotent(input);
  });

  it("transforms arrow function with inline type and default values", async () => {
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
    const result = await transformComponents(filePath);
    const output = readFile(filePath);

    expectResult(result).toMatchSnapshot();
    expect(output).toMatchSnapshot();
    await assertIdempotent(input);
  });

  it("preserves JSDoc comment on function declaration with inline type", async () => {
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
    const result = await transformComponents(filePath);
    const output = readFile(filePath);

    expectResult(result).toMatchSnapshot();
    expect(output).toMatchSnapshot();
    await assertIdempotent(input);
  });

  it("preserves named type reference and adds destructuring", async () => {
    const input = `type MediaProps = {
  variant: "video" | "image";
  media: Media | null;
  alt: string;
};

function MediaThumbnail({ variant, media, alt }: MediaProps) {
  const isVideo = variant === "video";
  const videoRef = useRef<HTMLVideoElement>(null);

  const thumbnail = (
    <MediaThumb
      item={media}
      alt={alt}
      fill
      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
      videoRef={videoRef}
    />
  );

  if (isVideo) {
    return (
      // biome-ignore lint/a11y/noStaticElementInteractions: Not necessary
      <div
        className="video-container"
        onMouseEnter={() => {
          videoRef.current?.play().catch(() => {});
        }}
        onMouseLeave={() => {
          videoRef.current?.pause();
        }}
      >
        {thumbnail}
      </div>
    );
  }

  return thumbnail;
}`;

    const filePath = writeTestFile(input);
    const result = await transformComponents(filePath);
    const output = readFile(filePath);

    expectResult(result).toMatchSnapshot();
    expect(output).toMatchSnapshot();
    expect(output).toContain("props: MediaProps");
    expect(output).not.toContain("MediaThumbnailProps");
    await assertIdempotent(input);
  });

  it("preserves async keyword on function declaration", async () => {
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
    const result = await transformComponents(filePath);
    const output = readFile(filePath);

    expectResult(result).toMatchSnapshot();
    expect(output).toMatchSnapshot();
    await assertIdempotent(input);
  });

  it("does not produce const props = props when destructuring pattern is props", async () => {
    const input = `const Foo = (props: {
  x: number;
  y: string;
}) => {
  return <div>{props.x} {props.y}</div>;
};`;

    const filePath = writeTestFile(input);
    const result = await transformComponents(filePath);
    const output = readFile(filePath);

    expectResult(result).toMatchSnapshot();
    expect(output).toMatchSnapshot();
    await assertIdempotent(input);
  });

  it("preserves order of multiple arrow functions", async () => {
    const input = `const Alpha = ({ x }: { x: number }) => <div>{x}</div>;
const Beta = ({ y }: { y: string }) => <div>{y}</div>;`;

    const filePath = writeTestFile(input);
    await transformComponents(filePath);
    const output = readFile(filePath);

    expect(output).toMatchSnapshot();
    await assertIdempotent(input);
  });

  it("preserves type alias before function declaration", async () => {
    const input = `function Foo({
  value
}: {
  value: string
}) {
  return <div>{value}</div>;
}`;

    const filePath = writeTestFile(input);
    await transformComponents(filePath);
    const output = readFile(filePath);

    expect(output).toMatchSnapshot();
    await assertIdempotent(input);
  });

  it("preserves formatting across multiple function declarations", async () => {
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
    await transformComponents(filePath);
    const output = readFile(filePath);

    expect(output).toMatchSnapshot();
    await assertIdempotent(input);
  });

  it("preserves destructuring order before body content", async () => {
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
    await transformComponents(filePath);
    const output = readFile(filePath);

    expect(output).toMatchSnapshot();
    await assertIdempotent(input);
  });

  it("preserves async and moves export default to end for arrow functions", async () => {
    const input = `const DashboardLayout = async ({ children }: { children: React.ReactNode }) => {
  return null;
};

export default DashboardLayout;`;

    const filePath = writeTestFile(input);
    await transformComponents(filePath);
    const output = readFile(filePath);

    expect(output).toContain("async function DashboardLayout(");
    const lines = output.trim().split("\n").filter(l => l.trim());
    expect(lines[lines.length - 1]).toBe("export default DashboardLayout;");
    await assertIdempotent(input);
  });

  it("transforms async arrow function with children prop", async () => {
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
    await transformComponents(filePath);
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
    await assertIdempotent(input);
  });
});
