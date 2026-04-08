require("./env");

const { randomUUID } = require("crypto");

const cors = require("cors");
const express = require("express");

const pool = require("./db");
const { AuthError, authenticateRequest, getFirebaseApp } = require("./firebaseAdmin");
const { DomainLookupError, lookupDomainsForAuthenticatedUser } = require("./domainLookupService");
const { logError, logInfo, logWarn, serializeError } = require("./logger");
const { InMemoryRateLimiter, RateLimitWindow } = require("./rateLimit");

const getEnvInt = (name, defaultValue) => {
  const rawValue = process.env[name];
  if (rawValue === undefined) return defaultValue;

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
};

const getEnvBool = (name, defaultValue = false) => {
  const rawValue = process.env[name];
  if (rawValue === undefined) return defaultValue;
  return ["1", "true", "yes", "on"].includes(rawValue.trim().toLowerCase());
};

const sendError = (res, req, { statusCode, code, message, details, headers }) => {
  const payload = {
    error: {
      code,
      message,
    },
    request_id: req.requestId,
  };

  if (details) {
    payload.error.details = details;
  }

  if (headers) {
    Object.entries(headers).forEach(([key, value]) => {
      res.setHeader(key, value);
    });
  }

  return res.status(statusCode).json(payload);
};

const buildRuntimeConfig = () => {
  getFirebaseApp();

  return {
    port: getEnvInt("PORT", 3000),
    requireProfileComplete: getEnvBool(
      "MY_REGISTERED_REQUIRE_PROFILE_COMPLETE",
      true
    ),
    limiter: new InMemoryRateLimiter({
      windows: [
        new RateLimitWindow({
          limit: getEnvInt("MY_REGISTERED_BURST_LIMIT", 6),
          windowSeconds: getEnvInt("MY_REGISTERED_BURST_WINDOW_SECONDS", 60),
          label: "burst",
        }),
        new RateLimitWindow({
          limit: getEnvInt("MY_REGISTERED_SUSTAINED_LIMIT", 30),
          windowSeconds: getEnvInt("MY_REGISTERED_SUSTAINED_WINDOW_SECONDS", 3600),
          label: "sustained",
        }),
      ],
    }),
  };
};

const createApp = (runtimeConfig) => {
  const app = express();

  app.set("trust proxy", 1);
  app.use(cors());
  app.use(express.json({ limit: "16kb" }));

  app.use((req, res, next) => {
    req.requestId = req.header("X-Request-Id")?.trim() || randomUUID();
    res.setHeader("X-Request-Id", req.requestId);
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  app.get("/test", (_req, res) => {
    res.json({ message: "Server is working!" });
  });

  app.get("/health", (req, res) => {
    res.json({
      status: "ok",
      service: "domain-api",
      request_id: req.requestId,
    });
  });

  app.post("/domains-by-phone", async (req, res) => {
    let authContext;

    try {
      if (!req.is("application/json")) {
        logWarn("domains_by_phone_invalid_content_type", {
          requestId: req.requestId,
          clientIp: req.ip,
          contentType: req.header("Content-Type") || "",
        });

        return sendError(res, req, {
          statusCode: 415,
          code: "INVALID_CONTENT_TYPE",
          message: "Requests must use application/json.",
        });
      }

      authContext = await authenticateRequest(req, {
        requireProfileComplete: runtimeConfig.requireProfileComplete,
      });

      const rateLimit = runtimeConfig.limiter.check({
        userKey: authContext.uid,
        clientKey: req.ip,
      });

      if (!rateLimit.allowed) {
        logWarn("domains_by_phone_rate_limited", {
          requestId: req.requestId,
          userId: authContext.uid,
          clientIp: req.ip,
          retryAfterSeconds: rateLimit.retryAfterSeconds,
        });

        return sendError(res, req, {
          statusCode: 429,
          code: "RATE_LIMIT_EXCEEDED",
          message:
            "You've reached your current lookup quota. Please try again after the reset period.",
          details: { retry_after_seconds: rateLimit.retryAfterSeconds },
          headers: rateLimit.headers,
        });
      }

      if (
        req.body !== undefined &&
        (req.body === null || Array.isArray(req.body) || typeof req.body !== "object")
      ) {
        logWarn("domains_by_phone_invalid_body", {
          requestId: req.requestId,
          userId: authContext.uid,
          clientIp: req.ip,
          bodyType: req.body === null ? "null" : typeof req.body,
        });

        return sendError(res, req, {
          statusCode: 400,
          code: "INVALID_JSON_BODY",
          message: "Request body must be a JSON object.",
          headers: rateLimit.headers,
        });
      }

      const data = await lookupDomainsForAuthenticatedUser({
        pool,
        profile: authContext.profile,
        claims: authContext.claims,
        requestId: req.requestId,
        userId: authContext.uid,
      });

      Object.entries(rateLimit.headers).forEach(([key, value]) => {
        res.setHeader(key, value);
      });

      logInfo("domains_by_phone_succeeded", {
        requestId: req.requestId,
        userId: authContext.uid,
        clientIp: req.ip,
        lookupPhone: data.phone,
        domainCount: data.domains.length,
      });

      return res.json({
        data,
        request_id: req.requestId,
      });
    } catch (error) {
      if (error instanceof AuthError || error instanceof DomainLookupError) {
        logWarn("domains_by_phone_failed", {
          requestId: req.requestId,
          userId: authContext?.uid,
          clientIp: req.ip,
          error: serializeError(error, { includeStack: false }),
        });

        return sendError(res, req, {
          statusCode: error.statusCode,
          code: error.code,
          message: error.message,
          details: error.details,
        });
      }

      logError("domains_by_phone_unexpected_failure", {
        requestId: req.requestId,
        userId: authContext?.uid,
        clientIp: req.ip,
        error: serializeError(error),
      });

      return sendError(res, req, {
        statusCode: 500,
        code: "INTERNAL_SERVER_ERROR",
        message: "This service is unavailable right now. Please try again shortly.",
      });
    }
  });

  app.use((error, req, res, next) => {
    if (error?.type === "entity.parse.failed") {
      logWarn("domains_by_phone_invalid_json", {
        requestId: req.requestId,
        clientIp: req.ip,
      });

      return sendError(res, req, {
        statusCode: 400,
        code: "INVALID_JSON_BODY",
        message: "Request body must contain valid JSON.",
      });
    }

    return next(error);
  });

  return app;
};

pool.on("error", (error) => {
  logError("postgres_pool_error", {
    error: serializeError(error),
  });
});

const runtimeConfig = buildRuntimeConfig();
const app = createApp(runtimeConfig);

app.listen(runtimeConfig.port, () => {
  logInfo("server_started", {
    port: runtimeConfig.port,
  });
});

module.exports = {
  app,
  buildRuntimeConfig,
  createApp,
  sendError,
};
