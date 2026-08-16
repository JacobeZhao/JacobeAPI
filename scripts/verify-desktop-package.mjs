import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";

const REQUIRED_DESKTOP_ENTRIES = [
  "desktop-manager.html",
  "desktop-orb.html",
  "desktop-quick.html",
];
const INSTALLER_NAME_PREFIX = "jacobeapi_";

function parseArgs(argv) {
  const options = {
    distDir: resolve("dist-desktop"),
    bundleDir: resolve("src-tauri/target/release/bundle/nsis"),
    binaryPath: resolve("src-tauri/target/release/jacobe-skills.exe"),
    outputDir: resolve("release"),
  };
  const flags = new Map([
    ["--dist-dir", "distDir"],
    ["--bundle-dir", "bundleDir"],
    ["--binary-path", "binaryPath"],
    ["--output-dir", "outputDir"],
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const key = flags.get(flag);
    if (!key) throw new Error(`unknown argument: ${flag}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`missing value for ${flag}`);
    options[key] = resolve(value);
    index += 1;
  }
  return options;
}

async function readPeSubsystem(path, label) {
  await assertNonemptyFile(path, label);
  const bytes = await readFile(path);
  const requireRange = (offset, length, field) => {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset + length > bytes.length) {
      throw new Error(`${label} has a truncated ${field}: ${path}`);
    }
  };

  requireRange(0, 64, "DOS header");
  if (bytes.toString("ascii", 0, 2) !== "MZ") {
    throw new Error(`${label} is not a PE executable (missing MZ header): ${path}`);
  }
  const peOffset = bytes.readUInt32LE(0x3c);
  requireRange(peOffset, 24, "PE header");
  if (bytes.toString("ascii", peOffset, peOffset + 4) !== "PE\0\0") {
    throw new Error(`${label} is not a PE executable (missing PE signature): ${path}`);
  }

  const optionalHeaderOffset = peOffset + 4 + 20;
  requireRange(optionalHeaderOffset, 70, "optional header");
  const optionalHeaderMagic = bytes.readUInt16LE(optionalHeaderOffset);
  if (optionalHeaderMagic !== 0x10b && optionalHeaderMagic !== 0x20b) {
    throw new Error(
      `${label} has an unsupported PE optional-header magic 0x${optionalHeaderMagic.toString(16)}: ${path}`,
    );
  }
  return bytes.readUInt16LE(optionalHeaderOffset + 68);
}

async function assertGuiSubsystem(path, label) {
  const subsystem = await readPeSubsystem(path, label);
  if (subsystem !== 2) {
    throw new Error(
      `${label} must use IMAGE_SUBSYSTEM_WINDOWS_GUI (2), found ${subsystem}: ${path}`,
    );
  }
  return subsystem;
}

async function assertSelfContainedDesktopBinary(path) {
  const bytes = await readFile(path);
  const forbiddenImports = ["WebView2Loader.dll", "libgcc_s_seh-1.dll", "libwinpthread-1.dll"];
  const contents = bytes.toString("latin1").toLowerCase();
  for (const dependency of forbiddenImports) {
    if (contents.includes(dependency.toLowerCase())) {
      throw new Error(
        `desktop release executable depends on unsupported external runtime ${dependency}: ${path}`,
      );
    }
  }
}

async function assertNonemptyFile(path, label) {
  let metadata;
  try {
    metadata = await stat(path);
  } catch {
    throw new Error(`${label} is missing: ${path}`);
  }
  if (!metadata.isFile()) throw new Error(`${label} is not a file: ${path}`);
  if (metadata.size === 0) throw new Error(`${label} is empty: ${path}`);
}

async function findNamedFile(root, expectedName) {
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      throw new Error(`cannot read directory ${directory}: ${error.message}`, { cause: error });
    }
    for (const entry of entries) {
      if (entry.isFile() && entry.name.toLowerCase() === expectedName.toLowerCase()) {
        return resolve(directory, entry.name);
      }
      if (entry.isDirectory()) pending.push(resolve(directory, entry.name));
    }
  }
  return null;
}

async function sha256(path) {
  const hash = createHash("sha256");
  await new Promise((resolvePromise, reject) => {
    const input = createReadStream(path);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("error", reject);
    input.on("end", resolvePromise);
  });
  return hash.digest("hex");
}

async function writeChecksums(outputDir, installers) {
  await mkdir(outputDir, { recursive: true });
  const lines = [];
  for (const installer of installers) {
    lines.push(`${await sha256(installer)}  ${basename(installer)}`);
  }
  const destination = resolve(outputDir, "SHA256SUMS.txt");
  await writeFile(destination, `${lines.join("\n")}\n`, "utf8");
  return destination;
}

async function main() {
  const { distDir, bundleDir, binaryPath, outputDir } = parseArgs(process.argv.slice(2));

  for (const entry of REQUIRED_DESKTOP_ENTRIES) {
    await assertNonemptyFile(resolve(distDir, entry), `desktop entry ${entry}`);
  }
  const manifest = await findNamedFile(distDir, "manifest.json");
  if (manifest) {
    throw new Error(`desktop output must not contain manifest.json: ${manifest}`);
  }

  let bundleEntries;
  try {
    bundleEntries = await readdir(bundleDir, { withFileTypes: true });
  } catch (error) {
    throw new Error(`cannot read NSIS bundle directory ${bundleDir}: ${error.message}`, {
      cause: error,
    });
  }
  const installers = bundleEntries
    .filter((entry) => {
      const name = entry.name.toLowerCase();
      return entry.isFile() && name.startsWith(INSTALLER_NAME_PREFIX) && name.endsWith(".exe");
    })
    .map((entry) => resolve(bundleDir, entry.name))
    .sort((left, right) => left.localeCompare(right, "en"));
  if (installers.length === 0) {
    throw new Error(`no JacobeAPI NSIS installer found in ${bundleDir}`);
  }
  for (const installer of installers) {
    await assertGuiSubsystem(installer, "NSIS installer");
  }
  const binarySubsystem = await assertGuiSubsystem(binaryPath, "desktop release executable");
  await assertSelfContainedDesktopBinary(binaryPath);

  const checksumFile = await writeChecksums(outputDir, installers);
  console.log(`Verified ${REQUIRED_DESKTOP_ENTRIES.length} desktop entries.`);
  console.log(`Verified ${installers.length} NSIS installer(s).`);
  console.log(`Verified desktop release PE subsystem: ${binarySubsystem} (Windows GUI).`);
  console.log("Verified desktop release has no unsupported external runtime dependencies.");
  console.log(`SHA-256 checksums: ${relative(process.cwd(), checksumFile)}`);
}

main().catch((error) => {
  console.error(`Desktop package verification failed: ${error.message}`);
  process.exitCode = 1;
});
