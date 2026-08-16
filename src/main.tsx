import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ManagerApp } from "./apps/ManagerApp";
import { extensionPlatform } from "./platform/extensionPlatform";
import { PlatformProvider } from "./platform/PlatformProvider";
import "./styles/base.css";
import "./styles/manager.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PlatformProvider services={extensionPlatform}>
      <ManagerApp />
    </PlatformProvider>
  </StrictMode>,
);
