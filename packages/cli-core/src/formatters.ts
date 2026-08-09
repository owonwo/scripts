import * as HelpDoc from "@effect/cli/HelpDoc";
import type { Cause } from "effect";

export const extractHelpDocText = (doc: HelpDoc.HelpDoc): string => {
  return HelpDoc.toAnsiText(doc).trim();
};

const formatDie = (cause: Cause.Cause<unknown>): string | null => {
  if (cause._tag !== "Die") return null;
  const defect = cause.defect;

  if (defect instanceof Error) return defect.message;
  if (typeof defect === "string") return defect;
  return null;
};

const formatErrors = <T>(cause: Cause.Cause<T>): string => {
  const causeStr = JSON.stringify(cause);
  const causeObj = JSON.parse(causeStr);
  const failure = causeObj.failure;

  if (failure && failure._tag === "InvalidValue") {
    const helpText = extractHelpDocText(failure.error);
    return helpText || "Invalid command arguments";
  }
  if (failure && failure._tag === "HelpRequested") {
    return extractHelpDocText(failure.helpDoc) || "";
  }

  const dieMsg = formatDie(cause);
  if (dieMsg) return dieMsg;

  return "An unexpected error occurred";
}

export const CliFormatter = {
  format: formatErrors
};
