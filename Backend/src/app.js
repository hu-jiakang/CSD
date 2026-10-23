import express from "express";

export function createApp({ customerRouter, storeRouter, customerStoreRouter, bindingRouter, dashboardSummaryRouter, syncRouter, authRouter, authMiddleware, customerStoreDownloadHandler }) {
  const app = express();

  if (typeof customerStoreDownloadHandler !== "function") {
    throw new Error("customerStoreDownloadHandler is required.");
  }
  app.use(express.json());

  app.get("/", (_req, res) => {
    res.json({ name: "Customer & Store Dashboard Backend", status: "running" });
  });

  app.get("/health", (_req, res) => {
    res.json({ success: true, status: "ok" });
  });

  app.use("/api/auth", authRouter);


  app.use("/api/customers", authMiddleware, customerRouter);
  app.use("/api/stores", authMiddleware, storeRouter);
  app.get("/api/customer-stores/download/:token", customerStoreDownloadHandler);

  app.use("/api/customer-stores", authMiddleware, customerStoreRouter);
  app.use("/api/bindings", authMiddleware, bindingRouter);
  app.use("/api/dashboard-summary", authMiddleware, dashboardSummaryRouter);
  app.use("/api/sync", authMiddleware, syncRouter);

  app.use((error, _req, res, _next) => {
    console.error(error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || "Internal server error.",
    });
  });

  return app;
}
