import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SidePanelApp } from "./apps/SidePanelApp";
import { extensionPlatform } from "./platform/extensionPlatform";
import { PlatformProvider } from "./platform/PlatformProvider";
import "./styles/base.css";
import "./styles/sidepanel.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PlatformProvider services={extensionPlatform}>
      <SidePanelApp />
    </PlatformProvider>
  </StrictMode>,
);
