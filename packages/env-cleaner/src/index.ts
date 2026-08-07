import { readFileSync } from "node:fs";
import { Args, Command } from "@effect/cli";
import { NodeContext, NodeRuntime } from "@effect/platform-node";
import { Console, Effect } from "effect";

const file = Args.file({ name: "file" });

const stripInlineComment = (line: string): string => {
  let inSingle = false,
    inDouble = false,
    inBacktick = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'" && !inDouble && !inBacktick) {
      inSingle = !inSingle;
      continue;
    }
    if (c === '"' && !inSingle && !inBacktick) {
      inDouble = !inDouble;
      continue;
    }
    if (c === "`" && !inSingle && !inDouble) {
      inBacktick = !inBacktick;
      continue;
    }
    if (c === "#" && !inSingle && !inDouble && !inBacktick) return line.slice(0, i);
  }
  return line;
};

const cleanEnv = (content: string): string =>
  content
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .map(stripInlineComment)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join("\n");

const command = Command.make("env-cleaner", { file }, ({ file }) =>
  Effect.sync(() => readFileSync(file, "utf8")).pipe(
    Effect.map((content) => cleanEnv(content)),
    Effect.map((cleaned) => Buffer.from(cleaned).toString("base64")),
    Effect.flatMap((encoded) => Console.log(encoded)),
  ),
);

Command.run(command, { name: "env-cleaner", version: "0.1.0" })(process.argv).pipe(
  Effect.provide(NodeContext.layer),
  NodeRuntime.runMain,
);
