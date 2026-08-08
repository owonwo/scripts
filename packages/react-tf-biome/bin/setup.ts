#!/usr/bin/env node

import { Command, Options } from "@effect/cli"
import { FileSystem, Path } from "@effect/platform"
import { NodeContext, NodeRuntime } from "@effect/platform-node"
import { Cause, Console, Effect } from "effect"

const PLUGINS = [
  "arrow-component.grit",
  "destructured-props-complex.grit",
  "inline-type-literal.grit",
  "rest-props-rename.grit",
] as const

const PLUGIN_NAMESPACE = "@wigxel/react-tf-biome/plugins"

// --- Error Formatting ---

const formatError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message || String(error)
  }
  if (typeof error === "object" && error !== null && "_tag" in error) {
    const tag = (error as { _tag: string })._tag
    if (tag === "InvalidValue") {
      return "Invalid CLI arguments. Use --help for usage information."
    }
    if (tag === "BadArgument") {
      return "Bad argument provided. Use --help for usage information."
    }
  }
  return String(error)
}

// --- Helpers ---

const parseJsonc = (text: string): Record<string, unknown> => {
  let out = ""
  let i = 0
  while (i < text.length) {
    const ch = text[i]!
    if (ch === '"') {
      let j = i + 1
      while (j < text.length) {
        if (text[j] === "\\") { j += 2; continue }
        if (text[j] === '"') { j++; break }
        j++
      }
      out += text.slice(i, j)
      i = j
    } else if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++
    } else if (ch === "/" && text[i + 1] === "*") {
      i += 2
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++
      i += 2
    } else {
      out += ch
      i++
    }
  }
  return JSON.parse(out)
}

const findBiomeConfig = (
  startDir: string,
  fs: FileSystem.FileSystem,
  path: Path.Path,
) =>
  Effect.gen(function* () {
    let dir = startDir
    const root = path.parse(dir).root

    while (dir !== root) {
      for (const name of ["biome.json", "biome.jsonc"]) {
        const p = path.join(dir, name)
        if (yield* fs.exists(p)) return p
      }
      dir = path.dirname(dir)
    }
    return null
  })

const getRelativePluginPaths = (): string[] => {
  return PLUGINS.map((p) => `./node_modules/${PLUGIN_NAMESPACE}/${p}`)
}

const hasPlugins = (config: Record<string, unknown>): boolean => {
  if (!Array.isArray(config.plugins)) return false
  return PLUGINS.every((p) =>
    (config.plugins as unknown[]).some(
      (plugin: unknown) =>
        typeof plugin === "string" && plugin.includes(p),
    ),
  )
}

const addPlugins = (
  config: Record<string, unknown>,
  pluginPaths: string[],
): Record<string, unknown> => ({
  ...config,
  plugins: [...((config.plugins as string[]) || []), ...pluginPaths],
})

// --- Dry Run ---

const dryRun = (biomePath: string | null, pluginPaths: string[]) =>
  Effect.gen(function* () {
    if (biomePath === null) {
      yield* Console.log("\n  No biome.json found in project root.\n")
      yield* Console.log("  Would create biome.json with 4 plugins:\n")
      pluginPaths.forEach((p) => Console.log(`    - ${p}`))
    } else {
      yield* Console.log(`\n  Found biome.json at ${biomePath}\n`)
      yield* Console.log("  Would add 4 plugins:\n")
      pluginPaths.forEach((p) => Console.log(`    - ${p}`))
    }
    yield* Console.log("\n  Run without --dry-run to apply changes.\n")
  })

// --- Apply ---

const apply = (
  biomePath: string | null,
  pluginPaths: string[],
  fs: FileSystem.FileSystem,
  path: Path.Path,
) =>
  Effect.gen(function* () {
    if (biomePath === null) {
      const config = { plugins: pluginPaths }
      yield* fs.writeFileString(
        "biome.json",
        JSON.stringify(config, null, 2) + "\n",
      )
      yield* Console.log("\n  Created biome.json with 4 plugins:\n")
      pluginPaths.forEach((p) => Console.log(`    - ${p}`))
    } else {
      const content = yield* fs.readFileString(biomePath)
      const config = parseJsonc(content)

      if (hasPlugins(config)) {
        yield* Console.log(
          "\n  Plugins already configured. Nothing to do.\n",
        )
        return
      }

      const updated = addPlugins(config, pluginPaths)
      yield* fs.writeFileString(
        biomePath,
        JSON.stringify(updated, null, 2) + "\n",
      )
      yield* Console.log(`\n  Added 4 plugins to ${biomePath}:\n`)
      pluginPaths.forEach((p) => Console.log(`    - ${p}`))
    }
  })

// --- CLI ---

const setupCommand = Command.make(
  "setup",
  {
    dryRun: Options.boolean("dry-run").pipe(Options.withAlias("d")),
  },
  ({ dryRun: isDryRun }) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path

      const biomePath = yield* findBiomeConfig(process.cwd(), fs, path)
      const pluginPaths = getRelativePluginPaths()

      if (isDryRun) {
        return yield* dryRun(biomePath, pluginPaths)
      }
      return yield* apply(biomePath, pluginPaths, fs, path)
    }),
)

const cli = Command.run(setupCommand, {
  name: "react-tf-biome",
  version: "v1.0.0",
})

cli(process.argv).pipe(
  Effect.provide(NodeContext.layer),
  Effect.tapError((error) => Console.error(`\n  ${formatError(error)}\n`)),
  Effect.catchAll(() => Effect.void),
  NodeRuntime.runMain,
)
