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

function hasOriginProtectedHelper(content, methodBody) {
  if (/assertSameOrigin\s*\(/.test(methodBody)) return true;

  const localFunctions = [...content.matchAll(
    /(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{[\s\S]*?\n\}/g
  )];

  for (const match of methodBody.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
    const name = match[1];
    const helper = localFunctions.find((candidate) => candidate[1] === name);
    if (helper) {
      const helperBody = helper[0];
      if (/assertSameOrigin\s*\(/.test(helperBody)) return true;
    }
  }

  return false;
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
      if (!body || !hasOriginProtectedHelper(content, body)) {
        failures.push(relative(process.cwd(), path) + ": " + method + " route is missing assertSameOrigin protection");
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
