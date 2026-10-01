import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

import { PrismaClient as PostgresqlPrismaClient } from "@/app/generated/prisma/postgresql/client";
import { PrismaClient as SqlitePrismaClient } from "@/app/generated/prisma/sqlite/client";
import { resolveDatabaseConfig } from "@/scripts/database-url.mjs";

type DatabaseClient = SqlitePrismaClient;

const globalForPrisma = globalThis as typeof globalThis & {
  db?: DatabaseClient;
};

function createPrismaClient(): DatabaseClient {
  const { provider, url } = resolveDatabaseConfig(process.env);

  if (provider === "sqlite") {
    return new SqlitePrismaClient({
      adapter: new PrismaBetterSqlite3({ url }),
    });
  }

  const configuredPoolMax = Number(process.env.DATABASE_POOL_MAX ?? "3");
  const poolMax =
    Number.isSafeInteger(configuredPoolMax) &&
    configuredPoolMax >= 1 &&
    configuredPoolMax <= 20
      ? configuredPoolMax
      : 3;
  const pool = new Pool({
    connectionString: url,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    max: poolMax,
  });
  const client = new PostgresqlPrismaClient({ adapter: new PrismaPg(pool) });

  // Both generated clients expose the same models and operations. Keeping one
  // public type prevents every caller from having to handle a union of clients.
  return client as unknown as DatabaseClient;
}

export const db = globalForPrisma.db ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.db = db;
}
