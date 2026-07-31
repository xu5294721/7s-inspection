import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.xiangtang.sevensinspection",
  appName: "7S巡检",
  webDir: "dist",
  android: {
    allowMixedContent: false,
  },
};

export default config;
