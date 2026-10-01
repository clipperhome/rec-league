/**
 * @typedef {{ provider: "sqlite" | "postgresql", url: string }} DatabaseConfig
 */

/**
 * Resolve and validate the database configuration shared by the app and Prisma.
 * SQLite is deliberately a development-only convenience; a production process
 * must always opt into durable PostgreSQL explicitly.
 *
 * @param {NodeJS.ProcessEnv} environment
 * @param {{ allowSqliteInProduction?: boolean }} [options]
 * @returns {DatabaseConfig}
 */
export function resolveDatabaseConfig(environment, options = {}) {
  const databaseUrl = environment.DATABASE_URL?.trim();
  const isProduction = environment.NODE_ENV?.trim() === "production";

  if (!databaseUrl) {
    if (isProduction) {
      throw new Error(
        "DATABASE_URL is required in production and must use a postgresql:// or postgres:// URL.",
      );
    }

    return { provider: "sqlite", url: "file:./dev.db" };
  }

  if (/^(?:postgresql|postgres):\/\//.test(databaseUrl)) {
    return { provider: "postgresql", url: databaseUrl };
  }

  if (databaseUrl.startsWith("file:")) {
    if (isProduction && !options.allowSqliteInProduction) {
      throw new Error(
        "SQLite DATABASE_URL values are not supported in production. Use a postgresql:// or postgres:// URL.",
      );
    }

    return { provider: "sqlite", url: databaseUrl };
  }

  throw new Error(
    "DATABASE_URL must be a file:, postgresql://, or postgres:// URL.",
  );
}
