import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { OrbApp } from "../apps/OrbApp";
import { PlatformProvider } from "../platform/PlatformProvider";
import { desktopPlatform } from "./desktopPlatform";
import "../styles/base.css";
import "../styles/orb.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PlatformProvider services={desktopPlatform}>
      <OrbApp />
    </PlatformProvider>
  </StrictMode>,
);
