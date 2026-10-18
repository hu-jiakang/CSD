import { authDb } from "../database.js";
import { hashPassword, verifyPassword, DEFAULT_FIRST_LOGIN_PASSWORD } from "./password.js";
function now(){return new Date().toISOString();}
export function getCredential(employeeNo){ return authDb.prepare("SELECT * FROM credentials WHERE employee_no = ?").get(employeeNo) || null; }
export function ensureDefaultCredential(employeeNo){
  let c=getCredential(employeeNo); if(c) return c;
  const {hash,salt}=hashPassword(String(employeeNo)); const t=now();
  authDb.prepare("INSERT INTO credentials(employee_no,password_hash,salt,must_change_password,created_at,updated_at) VALUES(?,?,?,?,?,?)").run(employeeNo,hash,salt,1,t,t);
  return getCredential(employeeNo);
}
export function verifyCredential(employeeNo,password){ const c=getCredential(employeeNo) || ensureDefaultCredential(employeeNo); return verifyPassword(password,c.password_hash,c.salt); }
export function setPassword(employeeNo,password){ const {hash,salt}=hashPassword(password); authDb.prepare("UPDATE credentials SET password_hash=?,salt=?,must_change_password=0,updated_at=? WHERE employee_no=?").run(hash,salt,now(),employeeNo); }
export function markLogin(employeeNo){authDb.prepare("UPDATE credentials SET last_login_at=?,updated_at=? WHERE employee_no=?").run(now(),now(),employeeNo);}
export function resetPassword(employeeNo){ const {hash,salt}=hashPassword(String(employeeNo)); const t=now(); authDb.prepare("INSERT INTO credentials(employee_no,password_hash,salt,must_change_password,created_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(employee_no) DO UPDATE SET password_hash=excluded.password_hash,salt=excluded.salt,must_change_password=1,updated_at=excluded.updated_at").run(employeeNo,hash,salt,1,t,t); }
