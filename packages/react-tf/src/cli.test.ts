import { Args, Command } from "@effect/cli";
import { NodeContext } from "@effect/platform-node";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

describe("Args path filtering", () => {
  it("filters long flags (--flag)", () => {
    const paths = Args.text({ name: "path" }).pipe(
      Args.repeated,
      Args.map((paths) => paths.filter((p) => !/^--?./.test(p))),
    );

    const command = Command.make("test", { paths }, ({ paths }) => Effect.succeed(paths));

    const program = Command.run(command, { name: "test", version: "0.1.0" })([
      "node",
      "test",
      "--debug",
      "--force",
      "src",
    ]);

    const result = program.pipe(Effect.provide(NodeContext.layer), Effect.runSyncExit);
    expect(result._tag).toBe("Success");
    if (result._tag === "Success") {
      expect(result.value).toEqual(["src"]);
    }
  });

  it("filters short flags (-d)", () => {
    const paths = Args.text({ name: "path" }).pipe(
      Args.repeated,
      Args.map((paths) => paths.filter((p) => !/^--?./.test(p))),
    );

    const command = Command.make("test", { paths }, ({ paths }) => Effect.succeed(paths));

    const program = Command.run(command, { name: "test", version: "0.1.0" })([
      "node",
      "test",
      "-d",
      "-f",
      "src",
    ]);

    const result = program.pipe(Effect.provide(NodeContext.layer), Effect.runSyncExit);
    expect(result._tag).toBe("Success");
    if (result._tag === "Success") {
      expect(result.value).toEqual(["src"]);
    }
  });

  it("filters mixed flags", () => {
    const paths = Args.text({ name: "path" }).pipe(
      Args.repeated,
      Args.map((paths) => paths.filter((p) => !/^--?./.test(p))),
    );

    const command = Command.make("test", { paths }, ({ paths }) => Effect.succeed(paths));

    const program = Command.run(command, { name: "test", version: "0.1.0" })([
      "node",
      "test",
      "--debug",
      "-f",
      "src",
      "dist",
    ]);

    const result = program.pipe(Effect.provide(NodeContext.layer), Effect.runSyncExit);
    expect(result._tag).toBe("Success");
    if (result._tag === "Success") {
      expect(result.value).toEqual(["src", "dist"]);
    }
  });

  it("returns empty array when only flags provided", () => {
    const paths = Args.text({ name: "path" }).pipe(
      Args.repeated,
      Args.map((paths) => paths.filter((p) => !/^--?./.test(p))),
    );

    const command = Command.make("test", { paths }, ({ paths }) => Effect.succeed(paths));

    const program = Command.run(command, { name: "test", version: "0.1.0" })([
      "node",
      "test",
      "--debug",
      "-f",
    ]);

    const result = program.pipe(Effect.provide(NodeContext.layer), Effect.runSyncExit);
    expect(result._tag).toBe("Success");
    if (result._tag === "Success") {
      expect(result.value).toEqual([]);
    }
  });

  it("preserves paths without dashes", () => {
    const paths = Args.text({ name: "path" }).pipe(
      Args.repeated,
      Args.map((paths) => paths.filter((p) => !/^--?./.test(p))),
    );

    const command = Command.make("test", { paths }, ({ paths }) => Effect.succeed(paths));

    const program = Command.run(command, { name: "test", version: "0.1.0" })([
      "node",
      "test",
      "src",
      "dist",
      "lib",
    ]);

    const result = program.pipe(Effect.provide(NodeContext.layer), Effect.runSyncExit);
    expect(result._tag).toBe("Success");
    if (result._tag === "Success") {
      expect(result.value).toEqual(["src", "dist", "lib"]);
    }
  });
});
