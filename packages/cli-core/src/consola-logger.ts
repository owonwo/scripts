import { createConsola } from "consola";
import { Logger, LogLevel } from "effect";

const consola = createConsola({
  formatOptions: {
    colors: true,
  },
});

const logger = Logger.make(({ logLevel, message }) => {
  const msg = Array.isArray(message) ? message.join(" ") : [];

  switch (logLevel) {
    case LogLevel.Debug:
      consola.debug(msg);
      break;
    case LogLevel.Warning:
      consola.warn(msg);
      break;
    case LogLevel.Error:
      consola.error(msg);
      break;
    case LogLevel.Fatal:
      consola.fatal(msg);
      break;
    default:
      consola.info(msg);
  }
});

export const ConsolaLayer = Logger.replace(Logger.defaultLogger, logger);
