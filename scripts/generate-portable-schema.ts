import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { z } from "zod";

import { leagueDocumentV1Schema } from "../lib/portable/schema";
import { PORTABLE_SCHEMA_URL } from "../lib/portable/types";

const targets = [
  resolve(process.cwd(), "schemas", "rec-league-v1.schema.json"),
  resolve(process.cwd(), "public", "schemas", "rec-league", "v1.json"),
];
const checkOnly = process.argv.includes("--check");
const generated = z.toJSONSchema(leagueDocumentV1Schema, {
  target: "draft-2020-12",
});
const schema = {
  ...generated,
  $id: PORTABLE_SCHEMA_URL,
  title: "Gameology Rec League portable document, version 1",
  description:
    "Portable league data. Cross-record references, privacy scopes, schedule collisions, and state transitions are additionally checked by the application validator.",
};

const bytes = `${JSON.stringify(schema, null, 2)}\n`;

for (const target of targets) {
  if (checkOnly) {
    if (!existsSync(target) || readFileSync(target, "utf8") !== bytes) {
      throw new Error(
        `${target} is missing or stale. Run npm run schema:generate and commit the result.`,
      );
    }
  } else {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes, "utf8");
  }
}

console.log(
  checkOnly
    ? "Portable JSON Schema artifacts are current."
    : "Generated source and public portable JSON Schema artifacts.",
);
