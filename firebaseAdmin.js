const admin = require("firebase-admin");

class AuthError extends Error {
  constructor({ code, message, statusCode, details }) {
    super(message);
    this.name = "AuthError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

const parseServiceAccount = () => {
  const rawValue = (process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim();
  if (!rawValue) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not configured.");
  }

  const candidates = [rawValue];
  if (
    rawValue.length >= 2 &&
    rawValue[0] === rawValue[rawValue.length - 1] &&
    [`"`, `'`].includes(rawValue[0])
  ) {
    candidates.push(rawValue.slice(1, -1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object") {
        if (typeof parsed.private_key === "string") {
          parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
        }
        return parsed;
      }
    } catch (_error) {
      // Try next candidate.
    }
  }

  try {
    const decoded = Buffer.from(rawValue, "base64").toString("utf8");
    const parsed = JSON.parse(decoded);
    if (typeof parsed.private_key === "string") {
      parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
    }
    return parsed;
  } catch (error) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON or base64-encoded JSON."
    );
  }
};

let firebaseApp;

const getFirebaseApp = () => {
  if (firebaseApp) return firebaseApp;

  firebaseApp = admin.apps.length
    ? admin.app()
    : admin.initializeApp({
        credential: admin.credential.cert(parseServiceAccount()),
      });

  return firebaseApp;
};

const getFirestore = () => admin.firestore(getFirebaseApp());

const extractBearerToken = (req) => {
  const headerValue = (req.header("Authorization") || "").trim();
  const [scheme, token] = headerValue.split(/\s+/, 2);

  if (!scheme || scheme.toLowerCase() !== "bearer" || !token) {
    throw new AuthError({
      code: "AUTH_REQUIRED",
      message: "Please sign in to continue.",
      statusCode: 401,
    });
  }

  return token.trim();
};

const verifyIdToken = async (token) => {
  try {
    const decoded = await admin.auth(getFirebaseApp()).verifyIdToken(token, true);
    if (!decoded?.uid) {
      throw new AuthError({
        code: "INVALID_TOKEN",
        message: "We couldn't verify your session. Please sign in again.",
        statusCode: 401,
      });
    }
    return decoded;
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }

    switch (error?.code) {
      case "auth/id-token-expired":
        throw new AuthError({
          code: "TOKEN_EXPIRED",
          message: "Your session has expired. Please sign in again.",
          statusCode: 401,
        });
      case "auth/id-token-revoked":
        throw new AuthError({
          code: "TOKEN_REVOKED",
          message: "Your session is no longer active. Please sign in again.",
          statusCode: 401,
        });
      case "auth/argument-error":
      case "auth/invalid-id-token":
        throw new AuthError({
          code: "INVALID_TOKEN",
          message: "We couldn't verify your session. Please sign in again.",
          statusCode: 401,
        });
      default:
        throw error;
    }
  }
};

const authenticateRequest = async (
  req,
  { requireProfileComplete = true } = {}
) => {
  const token = extractBearerToken(req);
  const claims = await verifyIdToken(token);
  const uid = String(claims.uid);

  const userDoc = await getFirestore().collection("users").doc(uid).get();
  if (!userDoc.exists) {
    throw new AuthError({
      code: "USER_PROFILE_NOT_FOUND",
      message:
        "This view is available to registered users with an eligible account.",
      statusCode: 403,
    });
  }

  const profile = userDoc.data() || {};
  const profileComplete = profile.profileComplete === true;

  if (requireProfileComplete && !profileComplete) {
    throw new AuthError({
      code: "PROFILE_INCOMPLETE",
      message: "Complete your profile to continue viewing registered domains.",
      statusCode: 403,
    });
  }

  return {
    uid,
    claims,
    profile,
    profileComplete,
  };
};

module.exports = {
  AuthError,
  authenticateRequest,
  getFirebaseApp,
  getFirestore,
};
