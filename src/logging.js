// src/logging.js

/**
 * Minimal, Worker-safe logger.
 *
 * This replaces ftn's `$lib/utils/logging.js`, which read `$app/environment`
 * (`dev`/`browser`) at module load and would not run in a Worker. The public
 * shape is deliberately the same — `logger`, `createLogger`, `setLogLevel`,
 * `getLogLevel` — so ported modules that call `logger.error(...)` keep working.
 *
 * The level defaults to INFO and can be overridden with `GENPROJ_LOG_LEVEL`
 * when a `process.env` shim is present (the Worker runs with `nodejs_compat`).
 * Logging always goes to the console; Workers observability captures it.
 */

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  SILENT: 4,
};

/** @returns {number} The configured level, defaulting to INFO. */
function initialLevel() {
  const configured = globalThis.process?.env?.GENPROJ_LOG_LEVEL?.toUpperCase();
  return LOG_LEVELS[configured] ?? LOG_LEVELS.INFO;
}

let currentLogLevel = initialLevel();

const EMOJI_MAP = {
  info: "💡",
  warn: "⚠️",
  error: "❌",
  debug: "🐞",
  auth: "🔑",
  api: "📡",
  database: "💾",
  file: "📄",
  system: "⚙️",
  user: "👤",
  performance: "⏱️",
  security: "🛡️",
};

/**
 * Creates a logger bound to a category.
 * @param {string} category Log category, shown in every line.
 * @returns {Record<string, (message: string, data?: unknown) => void>} Logger.
 */
export function createLogger(category) {
  const log = (level, message, data) => {
    let levelValue = LOG_LEVELS[level.toUpperCase()];
    if (levelValue === undefined) {
      levelValue = level === "security" ? LOG_LEVELS.WARN : LOG_LEVELS.INFO;
    }
    if (levelValue < currentLogLevel) {
      return;
    }

    const emoji = EMOJI_MAP[level] || "📝";
    const line = `${emoji} [${new Date().toISOString()}] [${category}] ${message}`;
    const method =
      level === "error"
        ? console.error
        : level === "warn" || level === "security"
          ? console.warn
          : console.log;

    if (data === undefined) {
      method(line);
    } else {
      method(line, data);
    }
  };

  const instance = {
    info: (message, data) => log("info", message, data),
    warn: (message, data) => log("warn", message, data),
    error: (message, data) => log("error", message, data),
    debug: (message, data) => log("debug", message, data),
  };

  for (const key of Object.keys(EMOJI_MAP)) {
    if (!instance[key]) {
      instance[key] = (message, data) => log(key, message, data);
    }
  }

  return instance;
}

/** Application logger. */
export const logger = createLogger("genproj");

/** Authentication logger. */
export const authLogger = createLogger("genproj:auth");

/** Database logger. */
export const dbLogger = createLogger("genproj:database");

/**
 * Sets the active log level.
 * @param {string} level One of DEBUG, INFO, WARN, ERROR, SILENT.
 */
export function setLogLevel(level) {
  const next = LOG_LEVELS[level.toUpperCase()];
  if (next === undefined) {
    logger.warn(`Invalid log level: ${level}`);
    return;
  }
  currentLogLevel = next;
}

/**
 * @returns {string} The active log level name.
 */
export function getLogLevel() {
  return (
    Object.keys(LOG_LEVELS).find(
      (key) => LOG_LEVELS[key] === currentLogLevel,
    ) || "INFO"
  );
}
