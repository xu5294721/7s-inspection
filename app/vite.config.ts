/// <reference types="vitest" />
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  base: "./",
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      includeAssets: [
        "favicon.svg",
        "fixtures/checklist-import-template.xlsx",
        "icons/*.png",
      ],
      manifest: {
        name: "7S巡检",
        short_name: "7S巡检",
        description: "向塘钢轨焊接整修车间7S移动巡检",
        lang: "zh-CN",
        display: "standalone",
        start_url: "./",
        scope: "./",
        background_color: "#ffffff",
        theme_color: "#146b4f",
        icons: [
          {
            src: "icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "icons/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        globPatterns: ["**/*.{html,js,css,svg,png,json,xlsx}"],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        navigateFallback: "index.html",
      },
    }),
  ],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    exclude: [...configDefaults.exclude, "tests/e2e/**", "**/*.stress.test.ts"],
  },
});
