import "dotenv/config";

import { closeSync, openSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { resolveDatabaseConfig } from "./database-url.mjs";

const { provider, url: databaseUrl } = resolveDatabaseConfig(process.env);
const migrationMode = process.argv[2] === "dev" ? "dev" : "deploy";

if (provider === "sqlite") {
  const valueWithoutQuery = databaseUrl.split("?", 1)[0];
  const rawPath = valueWithoutQuery.slice("file:".length);

  if (!rawPath) throw new Error("The SQLite DATABASE_URL must include a file path.");

  const databasePath = rawPath.startsWith("//")
    ? fileURLToPath(valueWithoutQuery)
    : resolve(decodeURIComponent(rawPath));

  // Prisma migrate deploy expects an SQLite file to exist. Opening in append
  // mode creates only that explicit database file and leaves existing data intact.
  closeSync(openSync(databasePath, "a"));
}

const prismaCli = resolve("node_modules/prisma/build/index.js");
const result = spawnSync(
  process.execPath,
  [prismaCli, "migrate", migrationMode],
  {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "inherit",
  },
);

if (result.error) throw result.error;
process.exit(result.status ?? 1);
