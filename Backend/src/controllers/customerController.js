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

function toCustomerApi(row) {
  return Object.fromEntries(CUSTOMER_API_FIELDS.map((key) => [key, row[key] ?? ""]));
}

export function createCustomerController({ customerService }) {
  return {
    async list(req, res, next) {
      try {
        const startRow = Number(req.query.startRow || 0);
        const limit = Math.min(
          500,
          Math.max(1, Number(req.query.limit || 500))
        );

        const data = await customerService.getCustomers({
          search: req.query.search || "",
          startRow,
          limit,
          access: req.access,
        });

        res.json({
          success: true,
          module: "BD_Customer",
          organization: "100",
          count: data.length,
          startRow,
          limit,
          data: data.map(toCustomerApi),
        });
      } catch (error) {
        next(error);
      }
    },
  };
}
