import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { CommaSeparatedHosts, HostPort, IntegerFromString, NonNegativeInteger, PositiveInteger } from "./schemas";

describe("Schemas", () => {
  describe("IntegerFromString", () => {
    it("decodes valid integer string", () => {
      const result = Schema.decodeUnknownEither(IntegerFromString())("42");
      expect(result._tag).toBe("Right");
      if (result._tag === "Right") expect(result.right).toBe(42);
    });

    it("fails on non-integer string", () => {
      const result = Schema.decodeUnknownEither(IntegerFromString())("hello");
      expect(result._tag).toBe("Left");
    });

    it("includes prefix in error message", () => {
      const result = Schema.decodeUnknownEither(IntegerFromString("--count"))("hello");
      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left.message).toContain("--count: expected an integer");
      }
    });
  });

  describe("PositiveInteger", () => {
    it("decodes valid positive integer", () => {
      const result = Schema.decodeUnknownEither(PositiveInteger())("42");
      expect(result._tag).toBe("Right");
      if (result._tag === "Right") expect(result.right).toBe(42);
    });

    it("fails on zero", () => {
      const result = Schema.decodeUnknownEither(PositiveInteger())("0");
      expect(result._tag).toBe("Left");
    });

    it("fails on negative integer", () => {
      const result = Schema.decodeUnknownEither(PositiveInteger())("-5");
      expect(result._tag).toBe("Left");
    });

    it("includes prefix in error message", () => {
      const result = Schema.decodeUnknownEither(PositiveInteger("--workers"))("-5");
      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left.message).toContain("--workers: must be a positive integer");
      }
    });
  });

  describe("NonNegativeInteger", () => {
    it("decodes valid non-negative integer", () => {
      const result = Schema.decodeUnknownEither(NonNegativeInteger())("0");
      expect(result._tag).toBe("Right");
      if (result._tag === "Right") expect(result.right).toBe(0);
    });

    it("fails on negative integer", () => {
      const result = Schema.decodeUnknownEither(NonNegativeInteger())("-1");
      expect(result._tag).toBe("Left");
    });

    it("includes prefix in error message", () => {
      const result = Schema.decodeUnknownEither(NonNegativeInteger("--offset"))("-1");
      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left.message).toContain("--offset: must be non-negative");
      }
    });
  });

  describe("HostPort", () => {
    it("decodes valid host:port", () => {
      const result = Schema.decodeUnknownEither(HostPort())("localhost:3000");
      expect(result._tag).toBe("Right");
      if (result._tag === "Right") expect(result.right).toBe("localhost:3000");
    });

    it("decodes IP address with port", () => {
      const result = Schema.decodeUnknownEither(HostPort())("127.0.0.1:8080");
      expect(result._tag).toBe("Right");
      if (result._tag === "Right") expect(result.right).toBe("127.0.0.1:8080");
    });

    it("fails on missing port", () => {
      const result = Schema.decodeUnknownEither(HostPort())("localhost");
      expect(result._tag).toBe("Left");
    });

    it("fails on invalid port", () => {
      const result = Schema.decodeUnknownEither(HostPort())("localhost:99999");
      expect(result._tag).toBe("Left");
    });

    it("includes prefix in error message", () => {
      const result = Schema.decodeUnknownEither(HostPort("--host"))("invalid");
      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left.message).toContain("--host: invalid address 'invalid', expected host:port");
      }
    });
  });

  describe("CommaSeparatedHosts", () => {
    it("decodes single address", () => {
      const result = Schema.decodeUnknownEither(CommaSeparatedHosts())("localhost:3000");
      expect(result._tag).toBe("Right");
      if (result._tag === "Right") expect(result.right).toEqual(["localhost:3000"]);
    });

    it("decodes multiple addresses", () => {
      const result = Schema.decodeUnknownEither(CommaSeparatedHosts())("localhost:3000,127.0.0.1:3001");
      expect(result._tag).toBe("Right");
      if (result._tag === "Right") expect(result.right).toEqual(["localhost:3000", "127.0.0.1:3001"]);
    });

    it("decodes addresses with whitespace", () => {
      const result = Schema.decodeUnknownEither(CommaSeparatedHosts())("localhost:3000 , 127.0.0.1:3001");
      expect(result._tag).toBe("Right");
      if (result._tag === "Right") expect(result.right).toEqual(["localhost:3000", "127.0.0.1:3001"]);
    });

    it("fails on empty string", () => {
      const result = Schema.decodeUnknownEither(CommaSeparatedHosts())("");
      expect(result._tag).toBe("Left");
    });

    it("fails on invalid address", () => {
      const result = Schema.decodeUnknownEither(CommaSeparatedHosts())("localhost:3000,invalid");
      expect(result._tag).toBe("Left");
    });

    it("includes prefix in error message", () => {
      const result = Schema.decodeUnknownEither(CommaSeparatedHosts("--addresses"))("bad");
      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left.message).toContain("--addresses: invalid address 'bad', expected host:port");
      }
    });
  });
});
