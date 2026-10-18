export function createBindingController({ bindingService }) {
  return {
    async store(req, res, next) {
      try {
        const storeCode = String(req.query.storeCode || "").trim().toUpperCase();
        if (!storeCode) return res.json({ success: true, count: 0, data: [] });

        const bindings = await bindingService.getBindings({ access: req.access });
        const data = bindings
          .filter((row) => String(row.storeCode || "").trim().toUpperCase() === storeCode)
          .filter((row) => !row.inactivePsNhtFl)
          .map((row) => ({
            promoterCode: row.promoterCode || "",
            promoterName: row.promoterName || row.promoterCode || "",
            role: row.role || "",
          }))
          .sort((a, b) => String(a.promoterName).localeCompare(String(b.promoterName)));

        return res.json({ success: true, count: data.length, data });
      } catch (error) {
        next(error);
      }
    },

    async search(req, res, next) {
      try {
        const query = String(req.query.search || "").trim().toUpperCase();
        const limit = Math.min(50, Math.max(1, Number(req.query.limit || 50)));
        if (!query) {
          return res.json({ success: true, count: 0, data: [] });
        }

        const bindings = await bindingService.getBindings({ access: req.access });
        const matches = bindings.filter((row) => {
          const haystack = [
            row.promoterCode,
            row.promoterName,
            row.role,
            row.storeCode,
            row.storeName,
            row.subRegion,
            row.region,
            row.district,
          ].join(" ").toUpperCase();
          return haystack.includes(query);
        });

        // One search result per promoter. Keep the first authorized store as
        // the navigation target and expose the number of matching assignments.
        const grouped = new Map();
        for (const row of matches) {
          const key = String(row.promoterCode || row.promoterName || "").trim().toUpperCase();
          if (!key) continue;
          const existing = grouped.get(key);
          if (existing) {
            existing.assignmentCount += 1;
            continue;
          }
          grouped.set(key, {
            promoterCode: row.promoterCode || "",
            promoterName: row.promoterName || row.promoterCode || "",
            role: row.role || "",
            storeCode: row.storeCode || "",
            storeName: row.storeName || "",
            subRegion: row.subRegion || "",
            region: row.region || "",
            district: row.district || "",
            inactivePsNhtFl: !!row.inactivePsNhtFl,
            assignmentCount: 1,
          });
        }

        const data = [...grouped.values()]
          .sort((a, b) => String(a.promoterName).localeCompare(String(b.promoterName)))
          .slice(0, limit);

        res.json({ success: true, count: data.length, data });
      } catch (error) {
        next(error);
      }
    },
  };
}
