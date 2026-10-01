import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const sqlitePath = resolve(process.cwd(), "prisma", "sqlite", "schema.prisma");
const postgresPath = resolve(
  process.cwd(),
  "prisma",
  "postgresql",
  "schema.prisma",
);
const [sqlite, postgres] = await Promise.all([
  readFile(sqlitePath, "utf8"),
  readFile(postgresPath, "utf8"),
]);

const normalizedSqlite = normalize(sqlite, "sqlite");
const normalizedPostgres = normalize(postgres, "postgresql");
if (normalizedSqlite !== normalizedPostgres) {
  throw new Error(
    "SQLite and PostgreSQL Prisma schemas differ beyond their provider and generated-client output.",
  );
}

console.log(
  "SQLite and PostgreSQL Prisma schemas have equivalent models, fields, relations, and indexes.",
);

function normalize(source, expectedProvider) {
  const providerMatches = source.match(/^\s*provider\s*=\s*"([^"]+)"\s*$/gmu) ?? [];
  if (providerMatches.length !== 2) {
    throw new Error(`Expected exactly two provider declarations in ${expectedProvider} schema.`);
  }
  if (!source.includes(`provider = "${expectedProvider}"`)) {
    throw new Error(`Expected ${expectedProvider} datasource provider.`);
  }
  const outputMatches = source.match(/^\s*output\s*=\s*"([^"]+)"\s*$/gmu) ?? [];
  if (outputMatches.length !== 1) {
    throw new Error(`Expected exactly one client output in ${expectedProvider} schema.`);
  }
  return source
    .replace(
      /^\s*output\s*=\s*"[^"]+"\s*$/mu,
      '  output   = "<provider-client>"',
    )
    .replace(
      new RegExp(`^\\s*provider\\s*=\\s*"${expectedProvider}"\\s*$`, "mu"),
      '  provider = "<database-provider>"',
    );
}
