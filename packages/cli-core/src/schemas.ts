import { ParseResult, Schema } from "effect";
import { Effect } from "effect";

export const IntegerFromString = (prefix?: string) =>
  Schema.transformOrFail(Schema.String, Schema.Int, {
    decode: (s, _options, ast) => {
      const n = Number(s);
      if (Number.isNaN(n) || !Number.isInteger(n)) {
        const msg = prefix ? `${prefix}: expected an integer` : "expected an integer";
        return Effect.fail(new ParseResult.Type(ast, s, msg));
      }
      return Effect.succeed(n);
    },
    encode: (n) => Effect.succeed(String(n)),
  });

export const PositiveInteger = (prefix?: string) =>
  Schema.transformOrFail(Schema.String, Schema.Int, {
    decode: (s, _options, ast) => {
      const n = Number(s);
      if (Number.isNaN(n) || !Number.isInteger(n)) {
        const msg = prefix ? `${prefix}: expected an integer` : "expected an integer";
        return Effect.fail(new ParseResult.Type(ast, s, msg));
      }
      if (n <= 0) {
        const msg = prefix ? `${prefix}: must be a positive integer` : "must be a positive integer";
        return Effect.fail(new ParseResult.Type(ast, n, msg));
      }
      return Effect.succeed(n);
    },
    encode: (n) => Effect.succeed(String(n)),
  });

export const NonNegativeInteger = (prefix?: string) =>
  Schema.transformOrFail(Schema.String, Schema.Int, {
    decode: (s, _options, ast) => {
      const n = Number(s);
      if (Number.isNaN(n) || !Number.isInteger(n)) {
        const msg = prefix ? `${prefix}: expected an integer` : "expected an integer";
        return Effect.fail(new ParseResult.Type(ast, s, msg));
      }
      if (n < 0) {
        const msg = prefix ? `${prefix}: must be non-negative` : "must be non-negative";
        return Effect.fail(new ParseResult.Type(ast, n, msg));
      }
      return Effect.succeed(n);
    },
    encode: (n) => Effect.succeed(String(n)),
  });

const HOST_PORT_REGEX = /^[a-zA-Z0-9._-]+:\d+$/;

export const HostPort = (prefix?: string) =>
  Schema.transformOrFail(Schema.String, Schema.String, {
    decode: (s, _options, ast) => {
      if (!HOST_PORT_REGEX.test(s)) {
        const msg = prefix
          ? `${prefix}: invalid address '${s}', expected host:port`
          : `invalid address '${s}', expected host:port`;
        return Effect.fail(new ParseResult.Type(ast, s, msg));
      }
      const port = Number(s.split(":")[1]);
      if (port < 1 || port > 65535) {
        const msg = prefix
          ? `${prefix}: port ${port} out of range (1-65535)`
          : `port ${port} out of range (1-65535)`;
        return Effect.fail(new ParseResult.Type(ast, s, msg));
      }
      return Effect.succeed(s);
    },
    encode: (s) => Effect.succeed(s),
  });

export const CommaSeparatedHosts = (prefix?: string) =>
  Schema.transformOrFail(Schema.String, Schema.Array(Schema.String), {
    decode: (s, _options, ast) => {
      if (s.trim().length === 0) {
        const msg = prefix ? `${prefix}: addresses cannot be empty` : "addresses cannot be empty";
        return Effect.fail(new ParseResult.Type(ast, s, msg));
      }

      const parts = s.split(",").map((p) => p.trim());

      for (const part of parts) {
        if (!HOST_PORT_REGEX.test(part)) {
          const msg = prefix
            ? `${prefix}: invalid address '${part}', expected host:port`
            : `invalid address '${part}', expected host:port`;
          return Effect.fail(new ParseResult.Type(ast, s, msg));
        }
        const port = Number(part.split(":")[1]);
        if (port < 1 || port > 65535) {
          const msg = prefix
            ? `${prefix}: port ${port} out of range (1-65535)`
            : `port ${port} out of range (1-65535)`;
          return Effect.fail(new ParseResult.Type(ast, s, msg));
        }
      }

      return Effect.succeed(parts);
    },
    encode: (hosts) => Effect.succeed(hosts.join(", ")),
  });
