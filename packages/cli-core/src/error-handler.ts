import consola from "consola";
import { type Cause, Effect } from "effect";
import { CliFormatter } from "./formatters";

export const CliErrorHandler = {
  /**
   * Wrap an Effect program to handle CLI errors:
   * formats the error with CliFormatter, prints to stderr, and exits cleanly.
   */
  formatErrors: <A, E, R>(
    program: Effect.Effect<A, E, R>,
  ) => {
    return program.pipe(
      Effect.tapErrorCause((cause) => Effect.sync(() => {
        const message = CliFormatter.format(cause as Cause.Cause<never>);
        if (message) {
          consola.error(message);
        }
      })
      ),
      Effect.ignore,
      eff => eff as Effect.Effect<void, never, never>
    )
  },
} as const;
