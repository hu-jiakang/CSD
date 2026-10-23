# Customer & Store Dashboard — Backend

## 1. Project Overview

The Customer & Store Dashboard Backend provides the API, authentication, authorization, local SQLite data storage, Kingdee synchronization, customer/store hierarchy, dashboard summary, bindings, and Excel export services for the EKSBASE Customer & Store Dashboard.

### Backend Runtime

- Backend port: `3002`
- Runtime: Node.js
- Framework: Express
- Database: SQLite
- Frontend communicates with this backend through `/api/*`
- Kingdee is the source system for master-data synchronization.
- Kingdee access uses a dedicated K3Cloud third-party application (App ID/App Secret); DingTalk credentials are never used as K3 authorization.
- Dashboard reads operational data from the local SQLite database.

---

## 2. Master Data Source

The backend synchronizes the following Kingdee master data.

### Customer

- Kingdee form: `BD_Customer`
- Organization: `100`
- Customer status uses `FForbidStatus`.

### Store

- Kingdee form: `BD_STOCK`
- Organization: `100`
- Valid store codes start with `STR.`
- Store status uses `FForbidStatus`.

### Department / Territory

Store Territory is resolved through `BD_Department` using:

- `F_RTA_Department.FNumber`

Department Territory uses the verified:

- `F_RTA_Territory.FNumber`
- `F_RTA_Territory.FName`

The invalid direct `F_RTA_Territory` Customer/Store field is not queried.

### Assistant PS

Store Assistant PS uses:

- `F_RTA_AssistantPSFL.FNumber`

Mapping:

| Code | Description |
|---|---|
| `DE` | Closed |
| `FLG` | Frontliner Gcash |
| `FLNG` | Frontliner NoGcash |
| `PS` | Promoter |

The invalid `F_RTA_AssistantPSFL.FName` field is not queried.

---

## 3. Employee Authentication

Employee authentication is based on Kingdee `BD_Empinfo`.

Relevant employee information includes:

- `FStaffNumber`
- `F_RTA_Department`
- `F_RTA_Department.FName`
- `F_RTA_Role`
- `F_RTA_Role.FName`
- `F_RTA_HireDate`
- `F_RTA_ResignDate`

### First Login

The initial login uses:

- Username: Employee No.
- Initial password: `EKSBASELOGIN`

The user must set a new password after the initial login.

Minimum password length:

- 8 characters

Authentication/session information is maintained in SQLite.

Session TTL:

- 8 hours

### Authentication API

```text
POST /api/auth/login
POST /api/auth/change-password
GET  /api/auth/me
POST /api/auth/logout
```

---

## 4. Authorization

Authorization is controlled by the employee's Kingdee role and department.

The role is read from:

```text
BD_Empinfo.F_RTA_Role.FNumber
```

Any role not included in the approved authorization matrix is rejected.

### Role Authorization Matrix

| Role | Access Scope |
|---|---|
| `ADMIN` | HQ |
| `CSH` | HQ |
| `RSD` | District |
| `LA` | District |
| `DRH` | District |
| `RAM` | Region |
| `RRM` | Region |
| `RTM` | Region |
| `RSH` | Region |
| `KAM` | Customer |
| `SLA` | Area |
| `SS` | Area |
| `ASM` | Area |

Detailed authorization rules are maintained in:

- `ROLE_AUTHORIZATION.md`
- `ACCESS_CONTROL_DESIGN.md`

These supporting documents should be retained.

---

## 5. Access Scope Rules

### ADMIN / CSH

HQ access includes:

- Stores
- Customers
- Customer Store data
- Applicable bindings

CSH department does not further restrict HQ access.

### District Roles

Applicable roles:

- `RSD`
- `LA`
- `DRH`

District filtering is applied to:

- Store
- Customer
- Customer Store
- Binding

DSTDLR Sales Department uses:

```text
HQ.DSTDLR
```

### Region Roles

Applicable roles:

- `RAM`
- `RRM`
- `RTM`
- `RSH`

Regional filtering is applied according to the configured organizational hierarchy.

### KAM

KAM access uses exact normalized matching between the employee department and applicable customer fields.

Matching does not perform hierarchy expansion or partial matching.

Customer scope may use:

- Customer Sales Department
- Customer Region
- Customer District

Store, Customer Store, and Binding scope is based on accessible customers/customer areas.

### Area Roles

Applicable roles:

- `SLA`
- `SS`
- `ASM`

Area roles have access to:

- Store
- Binding

Customer and Customer Store access is not provided to these roles.

### Matching Rules

Department comparisons use normalized:

- case
- whitespace

No partial-match expansion is performed.

---

## 6. Local Data Architecture

The backend uses SQLite as the local operational data store.

Kingdee data is synchronized into the local database and dashboard APIs read from the local database rather than repeatedly querying Kingdee for every dashboard request.

This provides:

- Faster dashboard loading
- Reduced Kingdee API traffic
- Consistent dashboard reads
- Centralized synchronization
- Separation between source-system synchronization and dashboard presentation

---

## 7. Kingdee Synchronization

The backend provides a synchronization service that retrieves master data from Kingdee and updates SQLite.

The synchronization includes:

- Customers
- Stores
- Departments
- Store/Promoter bindings
- Required employee information

The synchronization service prevents concurrent full synchronization runs.

If a synchronization is already running, another request uses the existing synchronization operation instead of starting a second concurrent full sync.

### Manual Refresh

```text
POST /api/sync/refresh
```

The endpoint:

1. Starts or uses the Kingdee synchronization process.
2. Updates the local SQLite data.
3. Clears the dashboard summary cache.
4. Returns synchronization statistics.

### Synchronization Status

```text
GET /api/sync/status
```

---

## 8. Dashboard Summary

Dashboard summary information is generated from the synchronized local data.

Summary caching is cleared after a successful manual synchronization so the dashboard reflects newly synchronized data.

---

## 9. Customer & Store APIs

Main protected API areas include:

```text
/api/customers
/api/stores
/api/customer-stores
/api/bindings
/api/dashboard-summary
/api/sync
```

Health endpoint:

```text
GET /health
```

Backend root:

```text
GET /
```

---

## 10. Customer & Store Hierarchy

The dashboard preserves the configured organizational hierarchy for customer and store reporting.

The hierarchy uses the appropriate Kingdee department/territory relationships rather than relying on invalid direct Customer/Store territory fields.

Customer and Store data sources are kept separate where required by the dashboard logic.

Customer Store reporting combines applicable customer, store, employee, and binding information according to the user's authorized scope.

---

## 11. Excel Export

The Customer & Store Dashboard supports Excel export.

Normal browser export returns the generated XLSX file directly.

### Temporary Shareable Export

For DingTalk environments, the frontend can request:

```text
POST /api/customer-stores/export?share=1
```

The backend creates a temporary Excel file and returns a download URL.

The temporary download endpoint is:

```text
GET /api/customer-stores/download/:token
```

The temporary link:

- Does not require dashboard login.
- Uses a cryptographically generated random token.
- Expires after 24 hours.
- Uses a generated temporary file.
- Removes expired files through cleanup logic.
- Does not expose an export ticket system.
- Uses a relative URL so the deployment host/domain is determined by the environment.

The public download route is intentionally handled separately from the authenticated dashboard API route.

---

## 12. Frontend / Backend Relationship

The frontend runs separately from the backend.

Current local configuration:

```text
Frontend: http://localhost:3003
Backend:  http://localhost:3002
```

The frontend Node server:

- Serves the static frontend.
- Proxies `/api/*` requests to the backend.
- Preserves API query strings.
- Handles the DingTalk export request flow.

The backend remains responsible for authentication, authorization, data access, synchronization, and export generation.

---

## 13. Development / Local Run

### Backend

From the Backend directory:

```powershell
npm install
npm start
```

### Basic Test

```text
GET /health
```

Expected response indicates that the backend is running.

Additional API testing should use an authenticated session where required.

---

## 14. Temporary / Diagnostic Endpoints

Temporary discovery endpoints used during earlier development phases are not part of the production architecture.

In particular, the old temporary employee-field discovery endpoint:

```text
GET /api/debug/employee-fields
```

must not be reintroduced into the production application.

Earlier master-data discovery endpoints were development-only and were removed after field verification.

---

## 15. Documentation Structure

The backend documentation is organized as follows:

```text
Backend/
├── README.md
├── ROLE_AUTHORIZATION.md
├── ACCESS_CONTROL_DESIGN.md
└── ...
```

### README.md

Main operational and technical overview.

### ROLE_AUTHORIZATION.md

Detailed role-to-access-scope matrix.

### ACCESS_CONTROL_DESIGN.md

Detailed authorization, filtering, hierarchy, and query-field design.

These supporting authorization documents should remain synchronized with the implementation.

---

## 16. Production Documentation Rules

Do not place the following in documentation:

- Passwords
- API secrets
- Client secrets
- Database credentials
- Private tokens
- Production authentication credentials

Environment-specific configuration must remain outside the README.

The README documents the architecture and configuration variable purpose, not secret values.

---

## 17. Production Verification Checklist

Before deployment or major release, verify:

- [ ] Backend starts successfully.
- [ ] `/health` responds successfully.
- [ ] Authentication works.
- [ ] First-login password change works.
- [ ] Subsequent login works.
- [ ] Unauthorized roles are rejected.
- [ ] ADMIN/CSH access works according to HQ rules.
- [ ] District filtering works.
- [ ] Region filtering works.
- [ ] KAM customer filtering works.
- [ ] Area-role restrictions work.
- [ ] Customer data synchronizes.
- [ ] Store data synchronizes.
- [ ] Department data synchronizes.
- [ ] Store/Promoter bindings synchronize.
- [ ] Manual synchronization works.
- [ ] Dashboard summary refreshes after synchronization.
- [ ] Customer Store data respects authorization scope.
- [ ] Normal Excel export works.
- [ ] DingTalk temporary Excel link works.
- [ ] Temporary export links expire correctly.
- [ ] No temporary diagnostic endpoints are exposed.
- [ ] Production secrets are supplied through the deployment environment.

---

## 18. Supporting Documentation

Keep these documents with the backend:

```text
ROLE_AUTHORIZATION.md
ACCESS_CONTROL_DESIGN.md
```

The main README provides the operational overview while the supporting documents retain the detailed authorization design.

---

## 19. Current Baseline

This README represents the consolidated backend documentation baseline after the Customer & Store Dashboard development phases covering:

- Master-data mapping
- Customer and Store hierarchy
- Authentication
- Role-based authorization
- Local SQLite architecture
- Kingdee synchronization
- Dashboard summary
- Customer Store reporting
- Excel export
- DingTalk temporary download links
- Production cleanup of temporary diagnostic functionality


## 18. Kingdee Third-Party Integration

The Dashboard uses the K3Cloud WebAPI third-party application authentication flow. It does not use the DingTalk SSO application as its Kingdee authorization.

Required environment variables:

```text
KINGDEE_ENABLED
KINGDEE_BASE_URL
KINGDEE_ERP_ACCOUNT
KINGDEE_INTEGRATION_USERNAME
KINGDEE_APP_ID
KINGDEE_APP_SECRET
KINGDEE_LANGUAGE_ID
```

The backend authenticates to K3Cloud through:

```text
Kingdee.BOS.WebApi.ServicesStub.AuthService.LoginByAppSecret.common.kdsvc
```

The integration username is the K3Cloud proxy/integration user bound to the third-party application. The App ID and App Secret belong to the K3Cloud third-party application.

`KINGDEE_ENABLED=false` prevents automatic startup/scheduled synchronization. Employee authentication and protected Dashboard operations still use the existing K3Cloud-backed Employee Master behavior when live K3Cloud access is required.

DingTalk remains an independent SSO provider and only supplies the user's identity/Employee No. for Dashboard authentication.

## Production Runtime Notes

- Use Node.js 22.13.0 or later. The backend uses the built-in `node:sqlite` `DatabaseSync` API; no third-party SQLite driver is required.
- On Node.js versions that still classify `node:sqlite` as experimental, Node may print an `ExperimentalWarning`. This warning is expected with the retained built-in driver and is intentionally not suppressed. It does not by itself indicate a database failure. Review Node.js release notes before changing the runtime major version.
- Install dependencies from the committed lockfile with `npm ci`, then run `npm run check` before starting the backend.
- The Kingdee scheduler remains controlled by `KINGDEE_SYNC_ON_STARTUP` and `KINGDEE_SYNC_INTERVAL_MINUTES`. The supplied `.env.example` retains the 30-minute interval; keep actual credentials in a deployment-only `.env` file and never commit or share it.
- Production packages must not include `node_modules`, `.env`, or local `data/*.db` files. Database files are environment-specific and should be backed up separately before deployment.
