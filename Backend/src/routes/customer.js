import { Router } from "express";

export function createCustomerRouter(controller) {
  const router = Router();

  router.get("/", controller.list);

  return router;
}
