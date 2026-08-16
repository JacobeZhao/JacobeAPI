const RESERVED_WINDOWS_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

export function safeFilename(value: string, extension: string, fallback = "jacobeapi-export"): string {
  const normalizedExtension = extension.replace(/^\.+/, "").replace(/[^a-z0-9]/gi, "") || "txt";
  const withoutControls = [...value.normalize("NFKC")]
    .filter((character) => character.charCodeAt(0) >= 32)
    .join("");
  let base = withoutControls
    .replace(/[<>:"/\\|?*]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^[. ]+/g, "")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 80);

  if (!base || RESERVED_WINDOWS_NAMES.test(base)) base = fallback;
  return `${base}.${normalizedExtension.toLowerCase()}`;
}
