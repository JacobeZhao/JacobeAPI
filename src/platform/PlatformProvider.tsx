import { createContext, type ReactNode, useContext } from "react";
import type { PlatformServices } from "./contracts";

const PlatformContext = createContext<PlatformServices | null>(null);

interface PlatformProviderProps {
  services: PlatformServices;
  children: ReactNode;
}

export function PlatformProvider({ services, children }: PlatformProviderProps) {
  return <PlatformContext.Provider value={services}>{children}</PlatformContext.Provider>;
}

// Provider and hook intentionally share the same context module.
// eslint-disable-next-line react-refresh/only-export-components
export function usePlatform(): PlatformServices {
  const services = useContext(PlatformContext);
  if (!services) throw new Error("usePlatform must be used inside PlatformProvider");
  return services;
}
