# CRM Backend

Secure Express + MongoDB authentication API with rotating refresh sessions.

## Setup

```bash
npm install
cp .env.example .env   # fill in secrets
npm run dev            # requires MONGODB_URI reachable
```

Generate secrets:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## Create first admin (protected bootstrap)

```bash
npm run create-admin -- --email admin@example.com --password 'Str0ng!Passw0rd...' --username admin --firstName Admin --lastName User --mobile +14155550100 --secret $ADMIN_BOOTSTRAP_SECRET
```

Refuses if an admin already exists or the secret is wrong.

## Seed fixed dev admin (local only)

```bash
# one-time, in your local gitignored .env (never commit this value):
# SEED_PASSWORD='YourStrongPassword...'
npm run seed-user -- --secret $ADMIN_BOOTSTRAP_SECRET
```

Seeds `Akash Raikwar <info@akashraikwar.in>` as admin. Idempotent — reruns report "Already seeded" without changes. Requires the bootstrap secret and `SEED_PASSWORD`.

## Tests

```bash
npm test   # prefers local MongoDB (isolated crm_test_* db, dropped after run),
           # falls back to mongodb-memory-server when unreachable
```

```bash
# Force the memory server even when local MongoDB is reachable:
$env:TEST_USE_MEMORY='1'; npm test        # PowerShell
TEST_USE_MEMORY=1 npm test                # bash
# Point tests at a non-default local MongoDB:
$env:TEST_MONGODB_URI='mongodb://127.0.0.1:27017'; npm test
```

## API

See root README for endpoint docs.
