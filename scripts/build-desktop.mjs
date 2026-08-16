import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const MSVC_TOOLCHAIN = "stable-x86_64-pc-windows-msvc";
const tauriCli = resolve("node_modules", "@tauri-apps", "cli", "tauri.js");
const args = [tauriCli, "build", "--bundles", "nsis", ...process.argv.slice(2)];

const defaultSigningKey = join(homedir(), ".tauri", "jacobeapi.key");
const defaultSigningPassword = join(homedir(), ".tauri", "jacobeapi-password.txt");
const signingEnvironment = process.env.TAURI_SIGNING_PRIVATE_KEY
  ? {}
  : existsSync(defaultSigningKey)
    ? {
        TAURI_SIGNING_PRIVATE_KEY: readFileSync(defaultSigningKey, "utf8"),
        TAURI_SIGNING_PRIVATE_KEY_PASSWORD: existsSync(defaultSigningPassword)
          ? readFileSync(defaultSigningPassword, "utf8").trim()
          : "",
      }
    : {};

const child = spawn(process.execPath, args, {
  env: {
    ...process.env,
    RUSTUP_TOOLCHAIN: MSVC_TOOLCHAIN,
    ...signingEnvironment,
  },
  stdio: "inherit",
});

child.on("error", (error) => {
  console.error(`Failed to start the Tauri build: ${error.message}`);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`Tauri build terminated by signal ${signal}.`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
