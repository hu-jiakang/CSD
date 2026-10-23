import { Router } from "express";

export function createBindingRouter(controller) {
  const router = Router();
  router.get("/search", controller.search);
  router.get("/store", controller.store);
  return router;
}
