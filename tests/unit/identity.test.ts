import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(path), "utf8")) as Record<string, unknown>;
}

describe("product identity compatibility", () => {
  it("uses the JacobeAPI brand while preserving stable desktop identities", () => {
    const manifest = readJson("public/manifest.json");
    const tauri = readJson("src-tauri/tauri.conf.json");
    const packageJson = readJson("package.json");
    const cargo = readFileSync(resolve("src-tauri/Cargo.toml"), "utf8");
    const packageScript = readFileSync(resolve("scripts/package.mjs"), "utf8");

    expect(manifest.name).toBe("JacobeAPI");
    expect(manifest.short_name).toBe("JacobeAPI");
    expect(tauri.productName).toBe("JacobeAPI");
    expect(tauri.identifier).toBe("com.jacobe.skills");
    expect(packageJson.name).toBe("jacobe-skills");
    expect(cargo).toMatch(/^name = "jacobe-skills"$/m);
    expect(packageScript).toContain("`jacobeapi-v${manifest.version}.zip`");
  });
});
