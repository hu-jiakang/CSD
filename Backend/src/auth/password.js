import crypto from "node:crypto";

import "dotenv/config";

// No administrator or shared initial password is embedded in source control.
export const DEFAULT_FIRST_LOGIN_PASSWORD = String(process.env.CSD_INITIAL_PASSWORD || "");
export const ADMIN_USERNAME = "ADMIN";
export const ADMIN_PASSWORD = String(process.env.CSD_ADMIN_PASSWORD || "");
export const PASSWORD_MIN_LENGTH = 8;
const N=16384, r=8, p=1, KEYLEN=64, SALTLEN=16;
export function hashPassword(password, salt=crypto.randomBytes(SALTLEN)) {
  const hash=crypto.scryptSync(String(password), salt, KEYLEN, {N,r,p,maxmem:32*1024*1024});
  return {hash:hash.toString("hex"), salt:salt.toString("hex")};
}
export function verifyPassword(password, hashHex, saltHex) {
  try { const actual=crypto.scryptSync(String(password), Buffer.from(saltHex,"hex"), KEYLEN, {N,r,p,maxmem:32*1024*1024}); return crypto.timingSafeEqual(actual, Buffer.from(hashHex,"hex")); } catch { return false; }
}
