export function createDashboardSummaryController({ dashboardSummaryService }) {
  return {
    async summary(req, res, next) {
      try {
        const level = String(req.query.level || "").trim();
        const parentValue = String(req.query.parentValue || "").trim();
        const search = String(req.query.search || "").trim();
        const view = String(req.query.view || "stores").trim().toLowerCase();
        const storeCode = String(req.query.storeCode || "").trim();
        const result = await dashboardSummaryService.getSummary({
          access: req.access,
          view,
          level,
          parentValue,
          storeCode,
          search,
        });
        res.json(result);
      } catch (error) {
        next(error);
      }
    },
  };
}
