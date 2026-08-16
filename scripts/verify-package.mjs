import { access, readdir, readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";

const dist = resolve("dist");
const manifestPath = join(dist, "manifest.json");
await access(manifestPath);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

if (manifest.name !== "JacobeAPI" || manifest.short_name !== "JacobeAPI") {
  throw new Error("manifest name and short_name must both be JacobeAPI");
}
if (manifest.action?.default_title !== "打开 JacobeAPI") {
  throw new Error("manifest action title must use the JacobeAPI brand");
}

const allowedPermissions = new Set(["storage", "sidePanel", "clipboardWrite"]);
for (const permission of manifest.permissions ?? []) {
  if (!allowedPermissions.has(permission)) throw new Error(`Unexpected permission: ${permission}`);
}
if (manifest.host_permissions?.length) throw new Error("host_permissions must be empty");

const required = [
  "index.html",
  "sidepanel.html",
  manifest.background?.service_worker,
  ...Object.values(manifest.icons ?? {}),
].filter(Boolean);
await Promise.all(required.map((file) => access(join(dist, file))));

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  }))).flat();
}

const files = await walk(dist);
const forbidden = files.filter((file) => /(?:\.map|\.env|\.idea|test-results|playwright-report)/i.test(file));
if (forbidden.length) throw new Error(`Forbidden package files: ${forbidden.join(", ")}`);

for (const file of files.filter((path) => [".js", ".html", ".css"].includes(extname(path)))) {
  const content = await readFile(file, "utf8");
  const remoteExecutionPatterns = [
    /<script[^>]+src=["']https?:\/\//i,
    /@import\s+(?:url\()?\s*["']?https?:\/\//i,
    /\bimport\s*(?:\(|["'])\s*["']?https?:\/\//i,
    /\b(?:fetch|importScripts|Worker|SharedWorker)\s*\(\s*["']https?:\/\//i,
  ];
  if (remoteExecutionPatterns.some((pattern) => pattern.test(content))) {
    throw new Error(`Remote executable resource found in ${file}`);
  }
}

console.log(`Verified ${files.length} packaged files with minimal permissions.`);
