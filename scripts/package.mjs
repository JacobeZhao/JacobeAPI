import { createWriteStream } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { ZipArchive } from "archiver";

const manifest = JSON.parse(await readFile(resolve("dist/manifest.json"), "utf8"));
const releaseDir = resolve("release");
const outputPath = resolve(releaseDir, `jacobeapi-v${manifest.version}.zip`);

await mkdir(releaseDir, { recursive: true });
await rm(outputPath, { force: true });

await new Promise((resolveArchive, rejectArchive) => {
  const output = createWriteStream(outputPath);
  const archive = new ZipArchive({ zlib: { level: 9 } });
  output.on("close", resolveArchive);
  output.on("error", rejectArchive);
  archive.on("error", rejectArchive);
  archive.pipe(output);
  archive.directory(resolve("dist"), false);
  archive.finalize();
});

console.log(`Created ${outputPath}`);
