import { Command, HelpDoc, Options, Span } from "@effect/cli";
import { NodeContext } from "@effect/platform-node";
import { Cause, Effect } from "effect";
import { describe, expect, it } from "vitest";
import { CliFormatter, extractHelpDocText as extractHelpDoc } from "./formatters";

describe("extractHelpDoc", () => {
  it("extracts text from Paragraph nodes", () => {
    const doc = HelpDoc.p("hello world");
    expect(extractHelpDoc(doc)).toMatchInlineSnapshot(`"hello world"`);
  });

  it("extracts text from Header nodes", () => {
    const doc = HelpDoc.h1("Title");
    expect(extractHelpDoc(doc)).toMatchInlineSnapshot(`"[0;1mTitle[0m"`);
  });

  it("concatenates Sequence nodes", () => {
    const doc = HelpDoc.sequence(HelpDoc.p("first"), HelpDoc.p("second"));
    expect(extractHelpDoc(doc)).toMatchInlineSnapshot(`
      "first

      second"
    `);
  });

  it("formats Enumeration nodes with dashes", () => {
    const doc = HelpDoc.enumeration([HelpDoc.p("option A"), HelpDoc.p("option B")]);
    expect(extractHelpDoc(doc)).toMatchInlineSnapshot(`
      "- option A

        - option B"
    `);
  });

  it("returns empty string for Empty nodes", () => {
    expect(extractHelpDoc(HelpDoc.empty)).toMatchInlineSnapshot(`""`);
  });

  it("handles DescriptionList nodes", () => {
    const doc = HelpDoc.descriptionList([[Span.text("term"), HelpDoc.p("definition")]]);
    expect(extractHelpDoc(doc)).toMatchInlineSnapshot(`
      "[0;1mterm[0m

        definition"
    `);
  });

  it("handles nested structures (Sequence of Paragraphs)", () => {
    const doc = HelpDoc.sequence(HelpDoc.p("line one"), HelpDoc.p("line two"));
    expect(extractHelpDoc(doc)).toMatchInlineSnapshot(`
      "line one

      line two"
    `);
  });

  it("handles Enumeration with nested Paragraphs", () => {
    const doc = HelpDoc.enumeration([HelpDoc.p("first"), HelpDoc.p("second")]);
    expect(extractHelpDoc(doc)).toMatchInlineSnapshot(`
      "- first

        - second"
    `);
  });
});

describe("CliFormatter.format", () => {
  it("formats InvalidValue errors", () => {
    const cause = Cause.fail({
      _tag: "InvalidValue",
      error: HelpDoc.p("Received unknown argument: '--foo'"),
    });
    expect(CliFormatter.format(cause)).toMatchInlineSnapshot(
      `"Received unknown argument: '--foo'"`
    );
  });

  it("formats HelpRequested errors", () => {
    const cause = Cause.fail({
      _tag: "HelpRequested",
      helpDoc: HelpDoc.p("Usage: my-cli [--help]"),
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
      Effect.provide(NodeContext.layer),
      Effect.runSyncExit,
    );

    expect(formatted).toMatchInlineSnapshot(`"Received unknown argument: '--invalid'"`);
  });
});
