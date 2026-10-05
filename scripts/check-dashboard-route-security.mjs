import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const root = "apps/dashboard/app/api";
const ignored = new Set(["node_modules", ".next", "dist", "build"]);
const extensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const failures = [];

function extractFunctionBody(content, method) {
  const marker = new RegExp("export async function " + method + "\\s*\\([^)]*\\)\\s*\\{");
  const match = marker.exec(content);
  if (!match) return null;
  const bodyStart = match.index + match[0].length;
  const nextExport = /\nexport async function (POST|PUT|PATCH|DELETE)\b/.exec(content.slice(bodyStart));
  const bodyEnd = nextExport ? bodyStart + nextExport.index : content.length;
  return content.slice(bodyStart, bodyEnd);
}

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

    for (const method of mutatingMethods) {
      const body = extractFunctionBody(content, method);
      if (!body || !/assertSameOrigin\s*\(/.test(body)) {
        failures.push(relative(process.cwd(), path) + ": " + method + " route is missing assertSameOrigin");
      }
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
