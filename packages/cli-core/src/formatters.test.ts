import { Command, Options } from "@effect/cli";
import { Cause, Effect } from "effect";
import { describe, expect, it } from "vitest";
import { CliFormatter } from "./formatters";

describe("CliFormatter.extractHelpDoc", () => {
  it("extracts text from Text nodes", () => {
    const doc = { _tag: "Text", value: "hello world" };
    expect(CliFormatter.extractHelpDoc(doc)).toMatchInlineSnapshot(`"hello world"`);
  });

  it("extracts text from Paragraph nodes", () => {
    const doc = {
      _tag: "Paragraph",
      value: { _tag: "Text", value: "paragraph text" },
    };
    expect(CliFormatter.extractHelpDoc(doc)).toMatchInlineSnapshot(`"paragraph text"`);
  });

  it("concatenates children in Sequence nodes", () => {
    const doc = {
      _tag: "Sequence",
      children: [
        { _tag: "Text", value: "first" },
        { _tag: "Text", value: "second" },
      ],
    };
    expect(CliFormatter.extractHelpDoc(doc)).toMatchInlineSnapshot(`
      "first
      second"
    `);
  });

  it("formats Enumeration nodes with dashes", () => {
    const doc = {
      _tag: "Enumeration",
      elements: [
        { _tag: "Text", value: "option A" },
        { _tag: "Text", value: "option B" },
      ],
    };
    expect(CliFormatter.extractHelpDoc(doc)).toMatchInlineSnapshot(`
      "  - option A
        - option B"
    `);
  });

  it("returns empty string for null input", () => {
    expect(CliFormatter.extractHelpDoc(null)).toMatchInlineSnapshot(`""`);
  });

  it("returns empty string for undefined input", () => {
    expect(CliFormatter.extractHelpDoc(undefined)).toMatchInlineSnapshot(`""`);
  });

  it("falls back to JSON.stringify for unknown tags", () => {
    const doc = { _tag: "Unknown", data: "test" };
    expect(CliFormatter.extractHelpDoc(doc)).toMatchInlineSnapshot(`
      "{"_tag":"Unknown","data":"test"}"
    `);
  });

  it("handles nested structures (Sequence of Paragraphs)", () => {
    const doc = {
      _tag: "Sequence",
      children: [
        {
          _tag: "Paragraph",
          value: { _tag: "Text", value: "line one" },
        },
        {
          _tag: "Paragraph",
          value: { _tag: "Text", value: "line two" },
        },
      ],
    };
    expect(CliFormatter.extractHelpDoc(doc)).toMatchInlineSnapshot(`
      "line one
      line two"
    `);
  });

  it("handles Enumeration with nested Text nodes", () => {
    const doc = {
      _tag: "Enumeration",
      elements: [
        { _tag: "Text", value: "first" },
        { _tag: "Paragraph", value: { _tag: "Text", value: "second" } },
      ],
    };
    expect(CliFormatter.extractHelpDoc(doc)).toMatchInlineSnapshot(`
      "  - first
        - second"
    `);
  });
});

describe("CliFormatter.format", () => {
  it("formats InvalidValue errors", () => {
    const cause = Cause.fail({
      _tag: "InvalidValue",
      error: { _tag: "Text", value: "Received unknown argument: '--foo'" },
    });
    expect(CliFormatter.format(cause)).toMatchInlineSnapshot(
      `"Received unknown argument: '--foo'"`
    );
  });

  it("formats HelpRequested errors", () => {
    const cause = Cause.fail({
      _tag: "HelpRequested",
      helpDoc: { _tag: "Text", value: "Usage: my-cli [--help]" },
    });
    expect(CliFormatter.format(cause)).toMatchInlineSnapshot(`"Usage: my-cli [--help]"`);
  });

  it("returns fallback message for unknown failures", () => {
    const cause = Cause.fail({ _tag: "SomethingElse" });
    expect(CliFormatter.format(cause)).toMatchInlineSnapshot(`"An unexpected error occurred"`);
  });

  it("returns fallback message for non-fail causes", () => {
    const cause = Cause.die(new Error("boom"));
    expect(CliFormatter.format(cause)).toMatchInlineSnapshot(`"boom"`);
  });

  it("extracts message from Die causes (runtime errors)", () => {
    const cause = Cause.die(new Error("connection refused"));
    expect(CliFormatter.format(cause)).toMatchInlineSnapshot(`"connection refused"`);
  });

  it("formats full InvalidValue from @effect/cli (unknown argument)", () => {
    const clusterId = Options.integer("cluster-id").pipe(
      Options.withAlias("c"),
      Options.withDefault(0),
    );

    const command = Command.make("tb-debugger", { clusterId }, () => Effect.void);

    const program = Command.run(command, { name: "tb-debugger", version: "0.1.0" })([
      "node", "tb-debugger", "--invalid",
    ]);

    let formatted = "";
    program.pipe(
      Effect.tapErrorCause((cause) =>
        Effect.sync(() => {
          formatted = CliFormatter.format(cause);
        }),
      ),
      Effect.ignore,
      Effect.runSync,
    );

    expect(formatted).toMatchInlineSnapshot(`"Received unknown argument: '--invalid'"`);
  });
});
