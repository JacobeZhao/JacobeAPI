import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ManagerApp } from "../apps/ManagerApp";
import { PlatformProvider } from "../platform/PlatformProvider";
import { desktopPlatform } from "./desktopPlatform";
import "../styles/base.css";
import "../styles/manager.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PlatformProvider services={desktopPlatform}>
      <ManagerApp />
    </PlatformProvider>
  </StrictMode>,
);
