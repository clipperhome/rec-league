import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { resolveDatabaseConfig } from "./database-url.mjs";

// Validate the caller's real production configuration before substituting the
// provider-specific placeholder URLs used only for client generation.
resolveDatabaseConfig(process.env);

const prismaCli = resolve("node_modules/prisma/build/index.js");
const clients = [
  {
    databaseUrl: "file:./dev.db",
    schema: "prisma/sqlite/schema.prisma",
  },
  {
    databaseUrl: "postgresql://generated:generated@localhost:5432/generated",
    schema: "prisma/postgresql/schema.prisma",
  },
];

for (const client of clients) {
  const result = spawnSync(
    process.execPath,
    [prismaCli, "generate", "--schema", client.schema],
    {
      env: {
        ...process.env,
        DATABASE_URL: client.databaseUrl,
        REC_LEAGUE_GENERATE_ALL_PROVIDERS: "1",
      },
      stdio: "inherit",
    },
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
