# Customer and Store Dashboard Frontend

Plain static frontend aligned with the EKSBASE-style deployment approach.

## Local production-style server

Requirements:
- Node.js
- Customer & Store Dashboard Backend running on port 3002

Start:

    node server.js

Frontend:
    http://localhost:3003/

The built-in Node server serves the static HTML/CSS/JavaScript files and proxies `/api/*` requests to `http://localhost:3002`.

No Vite.
No package.json.
No node_modules.
No npm install required.

The application functionality and API paths are preserved. The frontend remains on port 3003.
