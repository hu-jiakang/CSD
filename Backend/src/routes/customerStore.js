import { Router } from "express";

export function createCustomerStoreRouter(controller) {
  const router = Router();
  router.get("/", controller.list);
  router.get("/export", controller.export);
  return router;
}
