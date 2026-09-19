import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const roots = ["apps/bot/src", "apps/dashboard/app", "apps/dashboard/lib", "packages"];
const ignored = new Set(["node_modules", ".next", "dist", "build"]);
const extensions = new Set([".ts", ".tsx", ".js", ".mjs"]);
const failures = [];

async function walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (ignored.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(path);
      continue;
    }

    const ext = path.slice(path.lastIndexOf("."));
    if (!extensions.has(ext)) continue;

    const content = await readFile(path, "utf8");
    if (path !== "apps/bot/src/logger.ts" && /\bconsole\.(log|warn|error|info|debug)\s*\(/.test(content)) {
      failures.push(relative(process.cwd(), path) + ": direct console call");
    }
  }
}

for (const root of roots) await walk(root);

if (failures.length) {
  console.error("Observability contract failed:");
  for (const failure of failures) console.error(" - " + failure);
  process.exit(1);
}

console.log("Observability contract passed.");
