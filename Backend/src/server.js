import { config } from "./config/env.js";
import { KingdeeClient } from "./kingdee/kingdeeClient.js";
import { createCustomerService } from "./services/customerService.js";
import { createStoreService } from "./services/storeService.js";
import { createCustomerStoreService } from "./services/customerStoreService.js";
import { createDepartmentService } from "./services/departmentService.js";
import { createCustomerController } from "./controllers/customerController.js";
import { createStoreController } from "./controllers/storeController.js";
import { createCustomerStoreController } from "./controllers/customerStoreController.js";
import { createCustomerRouter } from "./routes/customer.js";
import { createStoreRouter } from "./routes/store.js";
import { createCustomerStoreRouter } from "./routes/customerStore.js";
import { createApp } from "./app.js";
import { createEmployeeService } from "./services/employeeService.js";
import { createBindingService } from "./services/bindingService.js";
import { createAccessService } from "./services/accessService.js";
import { createAuthService } from "./auth/authService.js";
import { createAuthController } from "./controllers/authController.js";
import { createAuthRouter } from "./routes/auth.js";
import { createAuthMiddleware } from "./middleware/auth.js";
import { createDashboardSummaryService } from "./services/dashboardSummaryService.js";
import { createDashboardSummaryController } from "./controllers/dashboardSummaryController.js";
import { createDashboardSummaryRouter } from "./routes/dashboardSummary.js";
import { createBindingController } from "./controllers/bindingController.js";
import { createBindingRouter } from "./routes/binding.js";
import { createMasterDataService } from "./services/masterDataService.js";
import { createDingTalkService } from "./services/dingtalkService.js";
import { createKingdeeSyncService } from "./services/kingdeeSyncService.js";
import { createSyncController } from "./controllers/syncController.js";
import { createSyncRouter } from "./routes/sync.js";
import * as bindingRepository from "./database/kingdeeDataRepository.js";
import { createExportDownloadService } from "./services/exportDownloadService.js";

const kingdeeClient = new KingdeeClient(config.kingdee);
const kingdeeSyncService = createKingdeeSyncService({ kingdeeClient, scope: config.scope });
const scope = config.scope;
const exportDownloadService = createExportDownloadService();

const departmentService = createDepartmentService();
const masterDataService = createMasterDataService();
const customerService = createCustomerService({ kingdeeClient, scope, departmentService, masterDataService });
const storeService = createStoreService({ kingdeeClient, scope, departmentService, masterDataService });

const customerController = createCustomerController({ customerService });
const storeController = createStoreController({ storeService });
const customerStoreService = createCustomerStoreService({ kingdeeClient, scope, departmentService, masterDataService });
const bindingService = createBindingService({ storeService, bindingRepository });
const customerStoreController = createCustomerStoreController({ customerStoreService, bindingService, exportDownloadService });
const bindingController = createBindingController({ bindingService });
const dashboardSummaryService = createDashboardSummaryService({ customerStoreService, bindingService });
const dashboardSummaryController = createDashboardSummaryController({ dashboardSummaryService });

const employeeService = createEmployeeService({ kingdeeClient, scope });
const dingtalkService = createDingTalkService({ config });
const accessService = createAccessService({ storeService, customerService, departmentService });
const authService = createAuthService({ employeeService, accessService, dashboardSummaryService, dingtalkService });
const authController = createAuthController({ authService });
const authMiddleware = createAuthMiddleware({ authService });


const app = createApp({
  customerRouter: createCustomerRouter(customerController),
  storeRouter: createStoreRouter(storeController),
  customerStoreRouter: createCustomerStoreRouter(customerStoreController),
  customerStoreDownloadHandler: customerStoreController.download,
  bindingRouter: createBindingRouter(bindingController),
  dashboardSummaryRouter: createDashboardSummaryRouter(dashboardSummaryController),
  syncRouter: createSyncRouter(createSyncController({ kingdeeSyncService, dashboardSummaryService })),
  authRouter: createAuthRouter({ controller: authController, authMiddleware }),
  authMiddleware,
});

app.listen(config.port, () => {
  console.log(`Customer & Store Dashboard Backend running on http://localhost:${config.port}`);
  console.log(`Kingdee organization scope: ${scope.organization}`);
  console.log(`Kingdee third-party integration: ${config.kingdeeEnabled ? "enabled" : "disabled"}`);
  console.log("Kingdee authentication: LoginByAppSecret (third-party App ID/App Secret)");
  console.log(`DingTalk SSO: configured separately from Kingdee (${config.dingtalk.clientId ? "configured" : "not configured"})`);
  console.log("Warehouse scope: FNumber LIKE 'STR.%'");

  const runScheduledSync = () => kingdeeSyncService.sync()
    .then((result) => { dashboardSummaryService.clearCache(); console.log("[KINGDEE SYNC] Completed:", result.stats); })
    .catch((error) => console.error("[KINGDEE SYNC] Failed; existing local data retained:", error));

  if (!config.kingdeeEnabled) {
    console.log("[KINGDEE] Third-party integration disabled. Live K3Cloud calls are not started by the scheduler.");
    console.log("[KINGDEE] Set KINGDEE_ENABLED=true after the dedicated K3Cloud third-party application is configured.");
    return;
  }

  if (config.kingdeeSyncOnStartup) runScheduledSync();
  if (config.kingdeeSyncIntervalMinutes > 0) {
    setInterval(runScheduledSync, config.kingdeeSyncIntervalMinutes * 60 * 1000);
    console.log(`[KINGDEE SYNC] Scheduled every ${config.kingdeeSyncIntervalMinutes} minute(s).`);
  }
});
