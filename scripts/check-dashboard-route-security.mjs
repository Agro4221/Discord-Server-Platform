import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const root = "apps/dashboard/app/api";
const ignored = new Set(["node_modules", ".next", "dist", "build"]);
const extensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
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

    const extension = path.slice(path.lastIndexOf("."));
    if (!extensions.has(extension)) continue;

    const content = await readFile(path, "utf8");
    const mutatingMethods = [...content.matchAll(/export async function (POST|PUT|PATCH|DELETE)\b/g)].map(
      (match) => match[1]
    );
    if (!mutatingMethods.length) continue;

    if (!content.includes("assertSameOrigin")) {
      failures.push(relative(process.cwd(), path) + ": mutating route is missing assertSameOrigin");
      continue;
    }

    if (!/assertSameOrigin\s*\(/.test(content)) {
      failures.push(relative(process.cwd(), path) + ": mutating route imports assertSameOrigin but never calls it");
    }
  }
}

await walk(root);

if (failures.length) {
  console.error("Dashboard route security contract failed:");
  for (const failure of failures) console.error(" - " + failure);
  process.exit(1);
}

console.log("Dashboard route security contract passed.");
