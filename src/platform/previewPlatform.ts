import type { PlatformServices } from "./contracts";
import { extensionPlatform } from "./extensionPlatform";

export const previewPlatform: PlatformServices = {
  ...extensionPlatform,
  kind: "preview",
};
