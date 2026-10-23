export function createSyncController({ kingdeeSyncService, dashboardSummaryService }) {
  return {
    async status(_req, res, next) {
      try { res.json({ success: true, running: kingdeeSyncService.isRunning(), stats: kingdeeSyncService.getStats() }); } catch (error) { next(error); }
    },
    async refresh(_req, res, next) {
      try { const result = await kingdeeSyncService.sync(); dashboardSummaryService.clearCache(); res.json({ success: true, ...result }); } catch (error) { next(error); }
    },
  };
}
