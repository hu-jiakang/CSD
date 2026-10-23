import express from "express";
export function createSyncRouter(controller) { const r=express.Router(); r.get("/status",controller.status); r.post("/refresh",controller.refresh); return r; }
