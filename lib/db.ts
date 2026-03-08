import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

import { Prisma, PrismaClient } from "@/app/generated/prisma/client";

const globalForPrisma = globalThis as typeof globalThis & {
  db?: PrismaClient;
};

const databaseUrl = process.env.DATABASE_URL ?? "file:./dev.db";

export const db = globalForPrisma.db ?? new PrismaClient({
  adapter: new PrismaBetterSqlite3({ url: databaseUrl }),
});

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.db = db;
}

export { Prisma };
