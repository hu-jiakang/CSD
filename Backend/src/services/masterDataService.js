import { getAllCustomers as getLocalCustomers, getAllStores as getLocalStores } from "../database/kingdeeDataRepository.js";

export function createMasterDataService() {
  return {
    getCustomers() { return getLocalCustomers(); },
    getStores() { return getLocalStores(); },
    clearCache() {},
  };
}
