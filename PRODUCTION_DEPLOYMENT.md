# Customer & Store Dashboard — Production Deployment

## Release contents

This source release includes the backend, static frontend, deployment configuration template, and project documentation. It intentionally excludes local SQLite databases, generated exports, installed `node_modules`, `.env` files, and macOS metadata. No live credentials or operational database snapshots should be distributed with the application source.

## Requirements

- Node.js 22 or newer (the backend uses `node:sqlite`)
- npm compatible with the installed Node.js version
- Network access from the backend host to the configured Kingdee K3Cloud endpoint
- A dedicated Kingdee K3Cloud third-party application and approved credentials
- DingTalk application configuration if DingTalk SSO is used

## Backend setup

1. Extract the release and open a terminal in `Customer_Store_Dashboard 2/Backend`.
2. Install the locked dependencies:

   ```sh
   npm ci --omit=dev
   ```

3. Create a local environment file from the template:

   ```sh
   cp .env.example .env
   ```

4. Edit `.env` on the deployment host. Fill in the approved Kingdee and DingTalk settings as applicable. Do not commit or distribute `.env`.
5. Confirm the organization scope and database paths before starting the service. Defaults are organization `100`, backend port `3002`, and local SQLite files under `Backend/data/`.
6. Start the backend:

   ```sh
   npm start
   ```

   Health check: `http://localhost:3002/health`

The sample configuration keeps Kingdee integration disabled until an administrator explicitly enables it after credentials and connectivity are verified. Once enabled, the defaults run a startup sync and then schedule synchronization every 30 minutes. Preserve `KINGDEE_SYNC_INTERVAL_MINUTES=30` unless an approved change is required. Do not start multiple backend instances against the same SQLite files.

## Frontend setup

Open a second terminal in `Customer_Store_Dashboard 2/Frontend` and run:

```sh
PORT=3003 BACKEND_URL=http://127.0.0.1:3002 node server.js
```

Open `http://localhost:3003/`. If frontend and backend run on different hosts, set `BACKEND_URL` to the backend's reachable internal URL and configure network access accordingly.

## Production security checklist

- Store secrets only in the deployment environment or a secret manager; never in source control or release ZIPs.
- Use HTTPS through an approved reverse proxy or load balancer for remote users; do not expose the Node development ports directly to the public internet.
- Restrict network access to the backend and SQLite files. Keep the `Backend/data` directory writable only by the service account.
- Back up both SQLite databases using an approved consistent backup procedure before upgrades. The source ZIP intentionally contains no live databases.
- Verify initial login/password-change policy, role/department access scopes, DingTalk SSO, exports, and sync behavior with authorized test accounts before rollout.
- Check startup logs and `/health` after deployment. Confirm the first Kingdee sync completes before relying on live dashboard data.
- Run one backend process per SQLite database directory; do not run overlapping deployments against the same files.

## Store Type fix in this release

Kingdee Store queries now request `F_PARV_StoreType.FName`. Both the Store service and Customer & Store service map Store Type from this field instead of relying on the blank `FStockType` value. Customer-only rows intentionally keep Store Type blank because they do not represent a linked Store.

## Validation performed for this package

- JavaScript syntax checks passed for all backend source `.js` files, the frontend server, and the frontend application script.
- The uploaded local database was inspected during preparation and intentionally excluded from this source-only release.
- Dependency installation was attempted, but the package-install command did not complete within the available execution window. Run `npm ci --omit=dev` on the deployment host and resolve any npm/network issues before rollout.
- Live Kingdee sync and dashboard display were confirmed by the project owner in their environment; they must still be rechecked after deployment to the target production host.
