export const CUSTOMER_FIELDS = [
  "FNumber",
  "FName",
  "FShortName",
  "F_RTA_CustClass",
  "F_RTA_AssCustClass.FNumber",
  "FGroup.FName",
  "FADDRESS",
  "FSALDEPTID.FName",
  "FSALDEPTID.FNumber",
  "F_RTA_Region.FName",
  "F_RTA_Region.FNumber",
  "FForbidStatus",
];

export const STORE_FIELDS = [
  "FNumber",
  "FName",
  "F_RTA_MallName",
  "FAddress",
  "FGroup.FName",
  "FGroup.FNumber",
  "F_RTA_Department.FName",
  "F_RTA_Department.FNumber",
  "F_RTA_Region.FName",
  "F_RTA_Region.FNumber",
  "F_RTA_Brand.FNumber",
  "F_RTA_MarketingChannel.FName",
  "F_RTA_MarketingChannel.FNumber",
  "FStockType",
  "F_PARV_StoreType.FName",
  "F_RTA_MainLine",
  "FCustomerId.FNumber",
  "FCustomerId.FName",
  "F_RTA_AssistantPSFL.FNumber",
  "FForbidStatus",
];

export const DEPARTMENT_FIELDS = [
  "FNumber",
  "FName",
  "F_RTA_Territory.FNumber",
  "F_RTA_Territory.FName",
];

// Phase 2 discovery candidates. These are tested individually because
// Kingdee rejects the complete query when a relation field is invalid.
export const CUSTOMER_RELATION_CANDIDATES = [
  "FSALDEPTID.FName",
  "FSALDEPTID.FNumber",
  "F_RTA_Region.FName",
  "F_RTA_Region.FNumber",
];

export const STORE_RELATION_CANDIDATES = [
  "FGroup.FName",
  "FGroup.FNumber",
  "F_RTA_Department.FName",
  "F_RTA_Department.FNumber",
  "F_RTA_Region.FName",
  "F_RTA_Region.FNumber",
  "F_RTA_Brand.FName",
  "F_RTA_Brand.FNumber",
  "F_RTA_MarketingChannel.FName",
  "F_RTA_MarketingChannel.FNumber",
  "FCustomerId.FNumber",
];
