import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SidePanelApp } from "../apps/SidePanelApp";
import { PlatformProvider } from "../platform/PlatformProvider";
import { desktopPlatform } from "./desktopPlatform";
import "../styles/base.css";
import "../styles/sidepanel.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PlatformProvider services={desktopPlatform}>
      <SidePanelApp />
    </PlatformProvider>
  </StrictMode>,
);
