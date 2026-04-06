class RateLimitWindow {
  constructor({ limit, windowSeconds, label }) {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new Error("Rate limit window limit must be a positive integer.");
    }

    if (!Number.isInteger(windowSeconds) || windowSeconds <= 0) {
      throw new Error(
        "Rate limit window windowSeconds must be a positive integer."
      );
    }

    this.limit = limit;
    this.windowSeconds = windowSeconds;
    this.label = label;
  }
}

class InMemoryRateLimiter {
  constructor({ windows }) {
    if (!Array.isArray(windows) || windows.length === 0) {
      throw new Error("At least one rate limit window is required.");
    }

    this.windows = windows;
    this.entries = new Map();
  }

  check({ userKey, clientKey }) {
    const primaryKey = (userKey || "").trim() || (clientKey || "").trim() || "anonymous";
    const now = Date.now();
    const snapshots = [];

    for (const window of this.windows) {
      const bucketKey = `${window.label}:${primaryKey}`;
      const bucket = this.entries.get(bucketKey) || [];
      const cutoff = now - window.windowSeconds * 1000;
      const activeBucket = bucket.filter((timestamp) => timestamp > cutoff);
      this.entries.set(bucketKey, activeBucket);

      if (activeBucket.length >= window.limit) {
        const retryAfterSeconds = Math.max(
          1,
          Math.ceil((activeBucket[0] + window.windowSeconds * 1000 - now) / 1000)
        );

        return {
          allowed: false,
          retryAfterSeconds,
          headers: this.buildHeaders({
            activeWindow: window,
            remaining: 0,
            retryAfterSeconds,
          }),
        };
      }

      const remainingAfterRequest = Math.max(
        window.limit - activeBucket.length - 1,
        0
      );
      const resetAfterSeconds =
        activeBucket.length > 0
          ? Math.max(
              1,
              Math.ceil((activeBucket[0] + window.windowSeconds * 1000 - now) / 1000)
            )
          : window.windowSeconds;

      snapshots.push({
        window,
        bucketKey,
        activeBucket,
        remainingAfterRequest,
        resetAfterSeconds,
      });
    }

    snapshots.forEach((snapshot) => {
      this.entries.set(snapshot.bucketKey, [...snapshot.activeBucket, now]);
    });

    snapshots.sort((a, b) => {
      if (a.remainingAfterRequest !== b.remainingAfterRequest) {
        return a.remainingAfterRequest - b.remainingAfterRequest;
      }
      return a.window.windowSeconds - b.window.windowSeconds;
    });

    const activeSnapshot = snapshots[0];
    return {
      allowed: true,
      retryAfterSeconds: 0,
      headers: this.buildHeaders({
        activeWindow: activeSnapshot.window,
        remaining: activeSnapshot.remainingAfterRequest,
        retryAfterSeconds: activeSnapshot.resetAfterSeconds,
      }),
    };
  }

  buildHeaders({ activeWindow, remaining, retryAfterSeconds }) {
    const policy = this.windows
      .map(
        (window) =>
          `${window.limit};w=${window.windowSeconds};name=${window.label}`
      )
      .join(", ");

    return {
      "Retry-After": String(retryAfterSeconds),
      "X-RateLimit-Limit": String(activeWindow.limit),
      "X-RateLimit-Remaining": String(remaining),
      "X-RateLimit-Reset": String(retryAfterSeconds),
      "X-RateLimit-Window": activeWindow.label,
      "X-RateLimit-Policy": policy,
    };
  }
}

module.exports = {
  InMemoryRateLimiter,
  RateLimitWindow,
};
