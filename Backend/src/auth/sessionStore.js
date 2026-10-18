import crypto from "node:crypto";
import { authDb } from "../database.js";
const TTL=8*60*60*1000;
function now(){return new Date().toISOString();}
export function createSession(employeeNo){const token=crypto.randomBytes(32).toString("hex"), created=Date.now(), expires=new Date(created+TTL).toISOString(); authDb.prepare("INSERT INTO sessions(token,employee_no,created_at,expires_at) VALUES(?,?,?,?)").run(token,employeeNo,new Date(created).toISOString(),expires); return {token,expiresAt:expires};}
export function getSession(token){const row=authDb.prepare("SELECT * FROM sessions WHERE token=?").get(token); if(!row)return null; if(Date.now()>=Date.parse(row.expires_at)){authDb.prepare("DELETE FROM sessions WHERE token=?").run(token);return null;} return row;}
export function deleteSession(token){authDb.prepare("DELETE FROM sessions WHERE token=?").run(token);}
