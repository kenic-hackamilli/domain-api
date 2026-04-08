const buildLogEntry = (level, event, details = {}) =>
  JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    service: "domain-api",
    event,
    ...details,
  });

const serializeError = (error, { includeStack = true } = {}) => {
  if (!error) {
    return undefined;
  }

  const payload = {
    name: error.name || "Error",
    message: error.message || String(error),
  };

  if (error.code) {
    payload.code = error.code;
  }

  if (error.statusCode) {
    payload.statusCode = error.statusCode;
  }

  if (error.details !== undefined) {
    payload.details = error.details;
  }

  if (includeStack && error.stack) {
    payload.stack = error.stack;
  }

  return payload;
};

const logInfo = (event, details = {}) => {
  console.log(buildLogEntry("info", event, details));
};

const logWarn = (event, details = {}) => {
  console.warn(buildLogEntry("warn", event, details));
};

const logError = (event, details = {}) => {
  console.error(buildLogEntry("error", event, details));
};

module.exports = {
  logError,
  logInfo,
  logWarn,
  serializeError,
};
