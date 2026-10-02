import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const roots = ["apps", "packages", "scripts"];
const patterns = [
  /\\bMT[A-Za-z0-9_-]{20,}\\b/,
  /\\bgh[pousr]_[A-Za-z0-9_]{30,}\\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /DISCORD_TOKEN\\s*=\\s*[^$\\s][^\\n#]+/,
  /CLIENT_SECRET\\s*=\\s*[^$\\s][^\\n#]+/
];
const failures = [];
const ignored = new Set(["node_modules", ".next", "dist", "build", ".git"]);
const extensions = new Set([".ts", ".tsx", ".js", ".mjs", ".json", ".yml", ".yaml", ".env"]);

async function walk(dir) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (ignored.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) { await walk(path); continue; }
    const ext = path.includes(".env") ? ".env" : path.slice(path.lastIndexOf("."));
    if (!extensions.has(ext)) continue;
    const content = await readFile(path, "utf8");
    if (patterns.some((pattern) => pattern.test(content))) failures.push(relative(process.cwd(), path));
  }
}

for (const root of roots) await walk(root);

if (failures.length) {
  console.error("Potential secret material found:", failures);
  process.exit(1);
}

console.log("Source hygiene check passed.");