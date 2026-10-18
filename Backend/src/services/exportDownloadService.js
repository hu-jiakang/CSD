import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EXPORT_DIR = path.resolve(__dirname, "../../tmp/exports");
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

function ensureDirectory() {
  fs.mkdirSync(EXPORT_DIR, { recursive: true });
}

function safeFilename(filename) {
  return String(filename || "Customer_Store_List.xlsx")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\.\.+/g, ".")
    .trim() || "Customer_Store_List.xlsx";
}

export function createExportDownloadService({ ttlMs = DEFAULT_TTL_MS } = {}) {
  ensureDirectory();

  const cleanupExpired = () => {
    const now = Date.now();

    for (const entry of fs.readdirSync(EXPORT_DIR, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;

      const metadataPath = path.join(EXPORT_DIR, entry.name);

      try {
        const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));

        if (!metadata.expiresAt || Number(metadata.expiresAt) <= now) {
          if (metadata.filePath && fs.existsSync(metadata.filePath)) {
            fs.rmSync(metadata.filePath, { force: true });
          }
          fs.rmSync(metadataPath, { force: true });
        }
      } catch {
        fs.rmSync(metadataPath, { force: true });
      }
    }
  };

  const create = ({ buffer, filename }) => {
    cleanupExpired();

    const token = crypto.randomBytes(32).toString("hex");
    const safeName = safeFilename(filename);
    const filePath = path.join(EXPORT_DIR, `${token}.xlsx`);
    const metadataPath = path.join(EXPORT_DIR, `${token}.json`);
    const expiresAt = Date.now() + ttlMs;

    fs.writeFileSync(filePath, buffer);
    fs.writeFileSync(
      metadataPath,
      JSON.stringify({
        filePath,
        filename: safeName,
        expiresAt,
      })
    );

    return {
      token,
      filename: safeName,
      expiresAt,
    };
  };

  const get = (token) => {
    cleanupExpired();

    if (!/^[a-f0-9]{64}$/i.test(String(token || ""))) {
      return null;
    }

    const metadataPath = path.join(EXPORT_DIR, `${token}.json`);

    if (!fs.existsSync(metadataPath)) {
      return null;
    }

    try {
      const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));

      if (!metadata.expiresAt || Number(metadata.expiresAt) <= Date.now()) {
        if (metadata.filePath && fs.existsSync(metadata.filePath)) {
          fs.rmSync(metadata.filePath, { force: true });
        }
        fs.rmSync(metadataPath, { force: true });
        return null;
      }

      if (!metadata.filePath || !fs.existsSync(metadata.filePath)) {
        return null;
      }

      return metadata;
    } catch {
      return null;
    }
  };

  return {
    create,
    get,
    cleanupExpired,
  };
}
