function toStoreApi(row) {
  return {
    storeCode: row.storeCode ?? "",
    storeName: row.storeName ?? "",
    mallOfStreetName: row.mallName ?? "",
    address: row.address ?? "",
    group: row.storeGroup ?? "",
    subRegion: row.department ?? "",
    region: row.region ?? "",
    district: row.territory ?? "",
    brand: row.brand ?? "",
    psOrFlStore: row.assistantPS ?? "",
    marketingChannel: row.marketingChannelCode ?? "",
    storeType: row.stockType ?? "",
    mainLineOfProducts: row.mainLine ?? "",
    customerCode: row.customerCode ?? "",
    customerName: row.customerName ?? "",
    customerShortName: row.customerShortName ?? "",
    disabled: row.disabled ?? "",
  };
}

export function createStoreController({ storeService }) {
  return {
    async list(req, res, next) {
      try {
        const startRow = Number(req.query.startRow || 0);
        const limit = Math.min(
          500,
          Math.max(1, Number(req.query.limit || 500))
        );

        const data = await storeService.getStores({
          search: req.query.search || "",
          startRow,
          limit,
          access: req.access,
        });

        res.json({
          success: true,
          module: "BD_STOCK",
          organization: "100",
          storeCodeFilter: "STR.*",
          count: data.length,
          startRow,
          limit,
          data: data.map(toStoreApi),
        });
      } catch (error) {
        next(error);
      }
    },
  };
}
