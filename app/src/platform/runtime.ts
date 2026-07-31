import { Capacitor } from "@capacitor/core";

interface CapacitorRuntime {
  isNativePlatform(): boolean;
  getPlatform(): string;
}

export interface PlatformRuntime {
  isNativeAndroid(): boolean;
}

export function createPlatformRuntime(capacitor: CapacitorRuntime): PlatformRuntime {
  return {
    isNativeAndroid: () => capacitor.isNativePlatform() && capacitor.getPlatform() === "android",
  };
}

export const browserPlatformRuntime = createPlatformRuntime(Capacitor);
