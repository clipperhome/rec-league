import { readFile, readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";

const outputRoot = resolve(process.cwd(), "dist");
const files = await listFiles(outputRoot);
if (files.length !== 1 || files[0] !== resolve(outputRoot, "rec-league.html")) {
  throw new Error(
    `Portable build must contain exactly dist/rec-league.html; found ${files.join(", ") || "nothing"}.`,
  );
}

const html = await readFile(files[0], "utf8");
const requiredCsp = [
  "default-src 'none'",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
];
for (const directive of requiredCsp) {
  if (!html.includes(directive)) throw new Error(`Portable CSP is missing ${directive}.`);
}

const forbidden = [
  [/<script\b[^>]*\bsrc\s*=/iu, "external script"],
  [/<link\b[^>]*rel=["']?stylesheet/iu, "external stylesheet"],
  [/<(?:img|iframe|audio|video|source)\b[^>]*\bsrc\s*=/iu, "external media"],
  [/@import\s+(?!["']?tailwindcss)/iu, "CSS import"],
  [/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\s*\(/u, "network API"],
];
for (const [pattern, label] of forbidden) {
  if (pattern.test(html)) throw new Error(`Portable build contains a ${label}.`);
}

if (!html.includes("Rec League") || !html.includes('id="root"')) {
  throw new Error("Portable build is missing its application shell.");
}

console.log(`Verified one self-contained offline file (${html.length} bytes).`);

async function listFiles(directory) {
  const entries = await readdir(directory);
  const files = [];
  for (const entry of entries) {
    const path = resolve(directory, entry);
    const metadata = await stat(path);
    if (metadata.isDirectory()) files.push(...(await listFiles(path)));
    else files.push(path);
  }
  return files.sort();
}
