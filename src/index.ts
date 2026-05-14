import * as fs from "fs";
import * as path from "path";
import { parse } from "dotenv";

console.log("Hello World");

const envPath = path.resolve(__dirname, "..", ".env");

if (!fs.existsSync(envPath)) {
  console.warn("Fichier .env introuvable:", envPath);
  process.exit(0);
}

const parsed = parse(fs.readFileSync(envPath, "utf8"));

console.log("Contenu de .env (clés et valeurs) :");
for (const [key, value] of Object.entries(parsed)) {
  console.log(`  ${key}=${value}`);
}
