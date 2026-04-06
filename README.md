# Domain API

Small Node/Express service for account-linked registry lookups.
The `/domains-by-phone` route is protected with Firebase Admin token
verification and server-side rate limits, and it resolves the lookup phone from
the authenticated user profile instead of trusting a client-supplied phone.

## Requirements

- Node.js 18+ recommended
- npm
- PostgreSQL connection details
- A Firebase service account JSON string for Admin SDK verification

## Environment

Required values:

```env
DB_HOST=...
DB_PORT=5432
DB_USER=...
DB_PASS=...
DB_NAME=...
FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"...","private_key_id":"...","private_key":"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n","client_email":"...","client_id":"...","token_uri":"https://oauth2.googleapis.com/token"}
```

Optional values:

```env
PORT=3000
MY_REGISTERED_REQUIRE_PROFILE_COMPLETE=true
MY_REGISTERED_BURST_LIMIT=6
MY_REGISTERED_BURST_WINDOW_SECONDS=60
MY_REGISTERED_SUSTAINED_LIMIT=30
MY_REGISTERED_SUSTAINED_WINDOW_SECONDS=3600
```

## First-Time Server Setup

```bash
cd /path/to/dotKE/domain-api
npm install
```

## Redeploy After Pulling Changes

Run these on every deploy so any new Node packages are installed before the
service restarts.

```bash
cd /path/to/dotKE/domain-api
npm install
node --check server.js
```

After that, restart the process you use to serve the app.

## Run Locally

```bash
cd /path/to/dotKE/domain-api
npm start
```

Default local URL:

```text
http://127.0.0.1:3000
```

## Quick Checks

Health check:

```bash
curl http://127.0.0.1:3000/health
```

Authenticated request example:

```bash
curl -X POST http://127.0.0.1:3000/domains-by-phone \
  -H "Authorization: Bearer <firebase_id_token>" \
  -H "Content-Type: application/json" \
  -d '{}'
```

## Notes

- The backend verifies the Firebase ID token with the Admin SDK.
- The caller must exist in Firestore at `users/{uid}`.
- By default, `profileComplete` must be `true` unless you set
  `MY_REGISTERED_REQUIRE_PROFILE_COMPLETE=false`.
- Rate limiting is enforced server-side even if the client is modified.
