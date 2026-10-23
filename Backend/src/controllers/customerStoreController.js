import { createXlsxWorkbook } from "../utils/xlsx.js";
import { createExportDownloadService } from "../services/exportDownloadService.js";

// These are the dashboard's business columns. Internal/helper codes used for
// filtering and hierarchy construction are intentionally not exported unless
// the dashboard specification names them as columns.
const CUSTOMER_COLUMNS = [
  ["Customer Code", "customerCode"],
  ["Customer Name", "customerName"],
  ["Customer Short Name", "customerShortName"],
  ["Customer Type", "customerType"],
  ["Customer Group", "customerGroup"],
  ["Address", "address"],
  ["Sales Dept", "salesDept"],
  ["Region", "region"],
  ["District", "district"],
  ["Inactive Customer", "disabled"],
];

const STORE_COLUMNS = [
  ["Store Code", "storeCode"],
  ["Store Name", "storeName"],
  ["Mall of Street Name", "mallOfStreetName"],
  ["Address", "address"],
  ["Group", "group"],
  ["Sub-region", "subRegion"],
  ["Region", "region"],
  ["District", "district"],
  ["Brand", "brand"],
  ["PS or FL Store", "psOrFlStore"],
  ["Marketing Channel", "marketingChannel"],
  ["Store Type", "storeType"],
  ["Main Line of Products", "mainLineOfProducts"],
  ["Customer Code", "customerCode"],
  ["Customer Name", "customerName"],
  ["Customer Short Name", "customerShortName"],
  ["Customer Region", "customerRegion"],
  ["Customer District", "customerDistrict"],
  ["Inactive Store", "disabled"],
];

// Customer Store List is exported in the business layout: Customer fields
// first, followed by the linked Store fields. No technical/helper columns
// are exported.
const CUSTOMER_STORE_COLUMNS = [
  ["Customer Code", "customerCode"],
  ["Customer Name", "customerName"],
  ["Customer Short Name", "customerShortName"],
  ["Customer Region", "customerRegion"],
  ["Customer District", "customerDistrict"],
  ["Inactive Customer", "customerDisabled"],
  ["Store Code", "storeCode"],
  ["Store Name", "storeName"],
  ["Mall of Street Name", "mallOfStreetName"],
  ["Address", "address"],
  ["Group", "group"],
  ["Sub-region", "subRegion"],
  ["Region", "region"],
  ["District", "district"],
  ["Brand", "brand"],
  ["PS or FL Store", "psOrFlStore"],
  ["Marketing Channel", "marketingChannel"],
  ["Store Type", "storeType"],
  ["Main Line of Products", "mainLineOfProducts"],
  ["Inactive Store", "disabled"],
];

const DSTDLR_COLUMNS = CUSTOMER_COLUMNS;

const BINDING_COLUMNS = [
  ["Store Code", "storeCode"],
  ["Store Name", "storeName"],
  ["Sub-region", "subRegion"],
  ["Region", "region"],
  ["District", "district"],
  ["Promoter Code", "promoterCode"],
  ["Promoter Name", "promoterName"],
  ["Role", "role"],
  ["Main Store", "mainStore"],
  ["Inactive PS/NHT/FL", "inactivePsNhtFl"],
];

function values(rows, columns) {
  return rows.map((row) => columns.map(([, key]) => row[key] ?? ""));
}

const CUSTOMER_API_FIELDS = [
  "customerCode",
  "customerName",
  "customerShortName",
  "customerType",
  "customerGroup",
  "address",
  "salesDept",
  "region",
  "district",
  "disabled",
];

const STORE_API_FIELDS = [
  "storeCode",
  "storeName",
  "mallOfStreetName",
  "address",
  "group",
  "subRegion",
  "region",
  "district",
  "brand",
  "psOrFlStore",
  "marketingChannel",
  "storeType",
  "mainLineOfProducts",
  "customerCode",
  "customerName",
  "customerShortName",
  "customerRegion",
  "customerDistrict",
  "disabled",
];

function pick(row, fields) {
  return Object.fromEntries(fields.map((key) => [key, row[key] ?? ""]));
}

function cleanCustomerHierarchy(hierarchy) {
  return hierarchy.map((district) => ({
    district: district.district ?? "",
    region: district.region ?? "",
    customers: (district.customers || []).map((customer) => pick(customer, CUSTOMER_API_FIELDS)),
  }));
}

function cleanStoreHierarchy(hierarchy) {
  return hierarchy.map((district) => ({
    district: district.district ?? "",
    regions: (district.regions || []).map((region) => ({
      region: region.region ?? "",
      subRegions: (region.subRegions || []).map((subRegion) => ({
        subRegion: subRegion.subRegion ?? "",
        stores: (subRegion.stores || []).map((store) => pick(store, STORE_API_FIELDS)),
      })),
    })),
  }));
}

export function createCustomerStoreController({ customerStoreService, bindingService, exportDownloadService = createExportDownloadService() }) {
  return {

    async download(req, res, next) {
      try {
        const download = exportDownloadService.get(req.params.token);

        if (!download) {
          return res.status(404).json({ success: false, error: "Download link is invalid or expired." });
        }

        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename="${download.filename}"`);
        res.sendFile(download.filePath);
      } catch (error) {
        next(error);
      }
    },

    async list(req, res, next) {
      try {
        const startRow = Math.max(0, Number(req.query.startRow || 0));
        const limit = Math.min(500, Math.max(1, Number(req.query.limit || 500)));
        const result = await customerStoreService.getCustomerStores({
          search: req.query.search || "",
          startRow,
          limit,
          access: req.access,
        });
        res.json({
          success: true,
          module: "CustomerStoreList",
          organization: "100",
          count: result.count,
          startRow,
          limit,
          data: result.customers.map((customer) => pick(customer, CUSTOMER_API_FIELDS)),
          customerHierarchy: cleanCustomerHierarchy(result.customerHierarchy),
          storeHierarchy: cleanStoreHierarchy(result.storeHierarchy),
        });
      } catch (error) {
        next(error);
      }
    },

    async export(req, res, next) {
      try {
        const result = await customerStoreService.getAllCustomerStores({
          search: req.query.search || "",
          access: req.access,
          fresh: true,
        });
        const bindingRows = await bindingService.getBindings({ access: req.access });

        const customerStoreRows = [...result.customerStoreRows].sort((a, b) => {
          const customerA = `${a.customerDistrict || ""}|${a.customerRegion || ""}|${a.customerCode || ""}|${a.storeCode || ""}`;
          const customerB = `${b.customerDistrict || ""}|${b.customerRegion || ""}|${b.customerCode || ""}|${b.storeCode || ""}`;
          return customerA.localeCompare(customerB);
        });

        const accessLevel = String(req.access?.accessLevel || "").trim().toUpperCase();
        const roleCode = String(req.access?.roleCode || req.access?.role || "").trim().toUpperCase();
        const isHQ = accessLevel === "HQ" || accessLevel === "ADMIN";
        const isRestrictedStoreBindingOnly = ["RRM", "DRH", "RTM"].includes(roleCode);
        const isDistrictOrRegion = !isRestrictedStoreBindingOnly && (accessLevel === "DISTRICT" || accessLevel === "REGION");
        const isCustomerLevel = accessLevel === "CUSTOMER";

        // Export sheet visibility is intentionally access-level specific:
        //
        // HQ:       Store List, Customer List, Binding List
        // District: Store List, Customer List, Customer Store List, Binding List, DSTDLR
        // Region:   Store List, Customer List, Customer Store List, Binding List, DSTDLR
        // RRM/DRH/RTM: Store List, Binding List only
        // Customer: Store List, Customer List, Customer Store List, Binding List
        // Area:     Store List, Binding List
        //
        // RRM/DRH/RTM are explicitly restricted to Store List + Binding List.
        // DSTDLR is therefore only exported for non-restricted District/Region users.
        // Its contents remain globally sourced by Sales Dept = HQ.DSTDLR and
        // are not restricted by the user's District/Region scope.
        const sheets = [
          {
            name: "Store List",
            headers: STORE_COLUMNS.map(([label]) => label),
            rows: values(result.storeRows, STORE_COLUMNS),
            statusHeader: "Inactive Store",
          },
        ];

        if (isHQ || isDistrictOrRegion || isCustomerLevel) {
          sheets.push({
            name: "Customer List",
            headers: CUSTOMER_COLUMNS.map(([label]) => label),
            rows: values(result.customerRows, CUSTOMER_COLUMNS),
            statusHeader: "Inactive Customer",
          });
        }

        if (isDistrictOrRegion || isCustomerLevel) {
          sheets.push({
            name: "Customer Store List",
            headers: CUSTOMER_STORE_COLUMNS.map(([label]) => label),
            rows: values(customerStoreRows, CUSTOMER_STORE_COLUMNS),
            statusHeader: "Inactive Store",
          });
        }

        sheets.push({
          name: "Binding List",
          headers: BINDING_COLUMNS.map(([label]) => label),
          rows: values(bindingRows, BINDING_COLUMNS),
          statusHeader: "Inactive PS/NHT/FL",
        });

        if (isDistrictOrRegion) {
          sheets.push({
            name: "DSTDLR",
            headers: DSTDLR_COLUMNS.map(([label]) => label),
            rows: values(result.dstDlrCustomers || [], DSTDLR_COLUMNS),
            statusHeader: "Inactive Customer",
          });
        }

        const workbook = createXlsxWorkbook(sheets);

        // Match the requested Customer Store List filename format:
        // Customer_Store_List_<Employee Department>_<YYYYMMDD_HHMMSS>.xlsx
        // The timestamp is captured when the export starts, not when the
        // workbook finishes generating.
        const now = new Date();
        const pad = (value) => String(value).padStart(2, "0");
        const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
        const employeeDepartment = String(req.employee?.department || req.employee?.departmentCode || "UNASSIGNED")
          .trim()
          .replace(/[\\/:*?"<>|]/g, "_");
        const filename = `Customer_Store_List_${employeeDepartment}_${timestamp}.xlsx`;
        if (String(req.query.share || "") === "1") {
          const download = exportDownloadService.create({ buffer: workbook, filename });
          res.json({
            success: true,
            filename: download.filename,
            expiresAt: download.expiresAt,
            downloadUrl: `/api/customer-stores/download/${download.token}`,
          });
          return;
        }

        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.send(workbook);
      } catch (error) {
        next(error);
      }
    },
  };
}
