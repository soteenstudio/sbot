import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Menentukan __dirname untuk ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const filePath = path.join(__dirname, "../../sbotc.json");

function loadConfig(): any {
  if (!fs.existsSync(filePath)) {
    console.error(`[Error] Configuration file not found at: ${filePath}`);
    return null;
  }

  try {
    const fileData = fs.readFileSync(filePath, "utf8");
    return JSON.parse(fileData);
  } catch (error) {
    console.error(`[Error] Failed to parse configuration file:`, error);
    return null;
  }
}

export const config = loadConfig();