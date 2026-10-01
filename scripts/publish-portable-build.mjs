import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const source = resolve(process.cwd(), "dist", "rec-league.html");
const destinationDirectory = resolve(process.cwd(), "public", "downloads");
const destination = resolve(destinationDirectory, "rec-league.html");

await mkdir(destinationDirectory, { recursive: true });
await copyFile(source, destination);
console.log("Published portable app to public/downloads/rec-league.html.");
