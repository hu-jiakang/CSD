import { Router } from "express";

export function createDashboardSummaryRouter(controller) {
  const router = Router();
  router.get("/", controller.summary);
  return router;
}
