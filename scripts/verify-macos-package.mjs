import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

if (process.platform !== "darwin") {
  console.error("macOS package verification must run on macOS.");
  process.exit(1);
}

const bundleRoot = resolve(
  "src-tauri",
  "target",
  "universal-apple-darwin",
  "release",
  "bundle",
);
const appPath = join(bundleRoot, "macos", "JacobeAPI.app");
const executableDirectory = join(appPath, "Contents", "MacOS");
const dmgDirectory = join(bundleRoot, "dmg");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
  });
  if (result.error) {
    fail(`Unable to run ${command}: ${result.error.message}`);
  }
  return result;
}

if (!existsSync(appPath) || !statSync(appPath).isDirectory()) {
  fail(`Missing macOS app bundle: ${appPath}`);
}

const executables = existsSync(executableDirectory)
  ? readdirSync(executableDirectory)
      .map((entry) => join(executableDirectory, entry))
      .filter((entry) => statSync(entry).isFile())
  : [];
if (executables.length !== 1) {
  fail(`Expected exactly one app executable, found ${executables.length}.`);
}

const lipo = run("lipo", ["-info", executables[0]], { capture: true });
if (lipo.status !== 0) {
  fail(lipo.stderr.trim() || "lipo could not inspect the app executable.");
}
const architectureInfo = `${lipo.stdout}\n${lipo.stderr}`;
for (const architecture of ["arm64", "x86_64"]) {
  if (!architectureInfo.includes(architecture)) {
    fail(`App executable is missing the ${architecture} architecture: ${architectureInfo.trim()}`);
  }
}

const dmgFiles = existsSync(dmgDirectory)
  ? readdirSync(dmgDirectory)
      .filter((entry) => entry.endsWith(".dmg"))
      .map((entry) => join(dmgDirectory, entry))
  : [];
if (dmgFiles.length !== 1) {
  fail(`Expected exactly one DMG, found ${dmgFiles.length}.`);
}
const dmgVerification = run("hdiutil", ["verify", dmgFiles[0]]);
if (dmgVerification.status !== 0) {
  fail(`DMG verification failed: ${dmgFiles[0]}`);
}

const signatureDetails = run("codesign", ["--display", "--verbose=2", appPath], {
  capture: true,
});
if (signatureDetails.status === 0) {
  const signatureVerification = run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath]);
  if (signatureVerification.status !== 0) {
    fail(`Code signature verification failed: ${appPath}`);
  }
  console.log("A code signature is present and valid.");
} else {
  console.log("No code signature is present; treating this as an unsigned test build.");
}

console.log(`Verified Universal app: ${basename(appPath)}`);
console.log(`Verified DMG: ${basename(dmgFiles[0])}`);
