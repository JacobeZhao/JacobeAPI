import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

const source = resolve("public/icons/brand-mark.svg");
const targetDir = resolve("public/icons");
await mkdir(targetDir, { recursive: true });

await Promise.all(
  [16, 32, 48, 128].map((size) =>
    sharp(source).resize(size, size).png().toFile(resolve(targetDir, `icon-${size}.png`)),
  ),
);
