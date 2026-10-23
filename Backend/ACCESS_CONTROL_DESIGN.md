# Customer & Store Dashboard Access Control

## Role authorization

`BD_Empinfo.F_RTA_Role.FNumber` is used only as the authorization gate.

Allowed role codes:

- ADMIN — HQ Admin
- ASM — Area Sales Manager
- CSH — Channel Sales Head
- DRH — District Retail Head
- KAM — Key Account Manager
- LA — Large Area
- RAM — Regional Account Manager
- RRM — Regional Retail Manager
- RSD — Regional Sales Director
- RSH — Regional Sales Head
- RTM — Regional Training Manager
- SLA — SLA
- SS — Area Sales Lead

Any other role code is rejected with HTTP 403 and does not receive a dashboard session.

## Role / Department / Sheet filtering

### ADMIN / CSH — HQ
- Store List: all Stores
- Customer List: all Customers, subject to existing Customer exclusions
- Customer Store List: not exported in the HQ sheet set
- Binding List: all applicable Bindings
- DSTDLR: not exported

CSH is explicitly HQ level. CSH Employee Department does not restrict HQ data.

### District roles — RSD / LA / DRH
- Store List: existing District-level Store filtering is preserved
- Customer List: existing District-level Customer filtering is preserved
- Customer Store List: existing District-level Customer/Store filtering is preserved
- Binding List: existing District-level Store filtering is preserved
- DSTDLR: Sales Dept = `HQ.DSTDLR`, with existing Customer exclusions

### Region roles — RAM / RRM / RTM / RSH
- Store List: existing Region-level Store filtering is preserved
- Customer List: existing Region-level Customer filtering is preserved
- Customer Store List: existing Region-level Customer/Store filtering is preserved
- Binding List: existing Region-level Store filtering is preserved
- DSTDLR: Sales Dept = `HQ.DSTDLR`, with existing Customer exclusions

### KAM — Customer Level
Employee Department is matched exactly against each Customer field independently:

`Customer Sales Dept = Employee Department OR Customer Region = Employee Department OR Customer District = Employee Department`

No parent/child hierarchy expansion and no partial matching are used.

- Store List: Stores associated with the KAM-accessible Customers (Customer Area basis)
- Customer List: Customers matching the three exact Customer fields above
- Customer Store List: Customer Store records associated with the KAM-accessible Customers / Customer Area of those Stores
- Binding List: Bindings for Stores associated with the KAM-accessible Customers / Customer Area
- DSTDLR: not exported

### Area roles — SLA / SS / ASM
- Store List: existing Area/Sub-region Store filtering is preserved
- Customer List: not available
- Customer Store List: not available
- Binding List: existing Area/Sub-region Store filtering is preserved
- DSTDLR: not exported

## Exact matching rule

Where multiple scope fields are specified, matching is:

`Field A == Employee Department OR Field B == Employee Department OR Field C == Employee Department`

Comparisons are normalized for case and surrounding whitespace only. Parent/child organizational relationships do not automatically expand the scope.

## Query-field safety

`FSALDEPTID.*` may be selected from `BD_Customer`, but it is not used in Kingdee WHERE clauses for the KAM Customer-level logic. `F_RTA_Territory.*` is not added to Customer or Store query fields; Store District remains resolved through `BD_Department`.
