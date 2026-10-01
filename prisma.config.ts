import "dotenv/config";
import { defineConfig } from "prisma/config";

import { resolveDatabaseConfig } from "./scripts/database-url.mjs";

const { provider, url: databaseUrl } = resolveDatabaseConfig(process.env, {
  // The generation script intentionally builds both clients. This exception is
  // private to that subprocess and never relaxes the application's runtime guard.
  allowSqliteInProduction:
    process.env.REC_LEAGUE_GENERATE_ALL_PROVIDERS === "1",
});
const providerDirectory = provider === "postgresql" ? "postgresql" : "sqlite";

export default defineConfig({
  schema: `prisma/${providerDirectory}/schema.prisma`,
  migrations: {
    path: `prisma/${providerDirectory}/migrations`,
  },
  datasource: {
    url: databaseUrl,
  },
});
