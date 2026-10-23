# Customer & Store Dashboard — Role Authorization

Employee authorization uses `BD_Empinfo.F_RTA_Role.FNumber` directly.

| Code | Role | Access Level |
|---|---|---|
| ADMIN | HQ Admin | HQ |
| CSH | Channel Sales Head | HQ |
| RSD | Regional Sales Director | District |
| LA | Large Area | District |
| DRH | District Retail Head | District |
| RAM | Regional Account Manager | Region |
| RRM | Regional Retail Manager | Region |
| RTM | Regional Training Manager | Region |
| RSH | Regional Sales Head | Region |
| KAM | Key Account Manager | Customer |
| SLA | SLA | Area |
| SS | Area Sales Lead | Area |
| ASM | Area Sales Manager | Area |

Any other or blank role code is rejected with HTTP 403 and no dashboard session is issued.

Role controls the dashboard access level and sheet set. Employee Department controls the applicable data scope according to the role's filtering rules.
