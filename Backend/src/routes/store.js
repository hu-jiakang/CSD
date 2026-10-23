import { Router } from "express";

export function createStoreRouter(controller) {
  const router = Router();

  router.get("/", controller.list);

  return router;
}
