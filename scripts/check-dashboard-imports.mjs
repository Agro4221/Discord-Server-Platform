import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";

const root = resolve("apps/dashboard");
const ignored = new Set(["node_modules", ".next", "dist", "build"]);
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function resolveLocalImport(file, specifier) {
  const base = resolve(dirname(file), specifier);
  const candidates = new Set([
    base,
    base + ".ts",
    base + ".tsx",
    base + ".js",
    base + ".jsx",
    base + ".mjs",
    base + ".cjs",
    base + ".json"
  ]);

  const extension = extname(base);
  if (extension === ".js" || extension === ".jsx" || extension === ".mjs" || extension === ".cjs") {
    const withoutExtension = base.slice(0, -extension.length);
    for (const candidate of [
      withoutExtension + ".ts",
      withoutExtension + ".tsx",
      withoutExtension + ".js",
      withoutExtension + ".jsx",
      withoutExtension + ".mjs",
      withoutExtension + ".cjs"
    ]) {
      candidates.add(candidate);
    }
  }

  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate;
  }

  for (const extensionCandidate of [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]) {
    const candidate = join(base, "index" + extensionCandidate);
    if (await exists(candidate)) return candidate;
  }

  return null;
}

function localSpecifiers(content) {
  const result = [];
  const seen = new Set();

  const patterns = [
    /\b(?:import|export)\s+(?:[^"'\n]+?\s+from\s+)?["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g
  ];

  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      const specifier = match[1];
      if (!specifier || !specifier.startsWith(".") || seen.has(specifier)) continue;
      seen.add(specifier);
      result.push({ specifier, index: match.index ?? 0 });
    }
  }

  return result;
}

async function walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files = [];
  for (const entry of entries) {
    if (ignored.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walk(path));
      continue;
    }
    if (sourceExtensions.has(extname(entry.name))) files.push(path);
  }
  return files;
}

const failures = [];
const files = await walk(root);

for (const file of files) {
  const content = await readFile(file, "utf8");
  for (const { specifier, index } of localSpecifiers(content)) {
    const target = await resolveLocalImport(file, specifier);
    if (target) continue;

    const line = content.slice(0, index).split("\n").length;
    failures.push({
      file: relative(process.cwd(), file),
      line,
      specifier
    });
  }
}

if (failures.length) {
  console.error("Broken Dashboard local imports:");
  for (const failure of failures) {
    console.error(
      "- " + failure.file + ":" + String(failure.line) + " -> " + failure.specifier
    );
  }
  process.exit(1);
}

console.log(
  "Dashboard local import check passed (" + String(files.length) + " source files scanned)."
);
