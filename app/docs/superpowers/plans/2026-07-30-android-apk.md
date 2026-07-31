# 7S巡检 Android APK Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a personally installable Android APK that runs the existing 7S inspection application fully offline and can save or share generated Word and ZIP backup files.

**Architecture:** Capacitor 8 embeds the existing Vite build in an Android WebView while IndexedDB remains the source of truth. A platform-neutral file-output port keeps browser behavior unchanged and sends native Android output through a bounded-memory, chunked Capacitor plugin that writes to MediaStore Downloads or launches the system share sheet.

**Tech Stack:** React 19, TypeScript 6, Vite 8, Vitest 4, Capacitor 8.4.2, Java, Android SDK 36, Gradle 8.14.3, Android MediaStore and FileProvider.

## Global Constraints

- Android application id is `com.xiangtang.sevensinspection`; display name is `7S巡检`.
- `minSdkVersion` is 29; `compileSdkVersion` and `targetSdkVersion` are 36.
- Capacitor Core, CLI and Android versions are exactly `8.4.2`.
- Gradle Wrapper version is `8.14.3`.
- APK assets must be local; no `192.168.*`, `127.0.0.1:4175`, or remote `server.url` may enter the Android package.
- Do not request `MANAGE_EXTERNAL_STORAGE`; public downloads use MediaStore on Android 10+.
- Keep the browser/PWA build functional and preserve all existing Word content and layout behavior, including no annex table.
- Preserve the completed Word conditional-heading behavior: explicitly cleared template headings remain omitted, empty photo categories do not appear, and situation/category headings retain the configured first-line indent.
- Preserve existing IndexedDB records and database schema; do not add cloud sync or a business API.
- Transfer generated Blob data to Android in 256 KiB chunks so large photo backups are not encoded as one base64 string.
- Do not modify the three source DOCX files in `C:\Users\xj\Desktop\7s管理\`.
- This directory is not a Git repository. End every task with focused tests and an independent review checkpoint instead of a Git commit.

---

### Task 1: Capacitor Runtime And Android Shell

**Files:**
- Create: `src/platform/runtime.ts`
- Create: `src/platform/runtime.test.ts`
- Create: `capacitor.config.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Generate: `android/`
- Copy: `public/icons/icon-512.png` to `resources/icon-only.png`

**Interfaces:**
- Produces: `PlatformRuntime` with `isNativeAndroid(): boolean`.
- Produces: `browserPlatformRuntime` used by later file-output and PWA tasks.
- Produces: a Capacitor Android project whose `webDir` is `dist`.

- [ ] **Step 1: Install only the pinned Capacitor build dependencies**

Run:

```powershell
pnpm add @capacitor/core@8.4.2 @capacitor/android@8.4.2
pnpm add -D @capacitor/cli@8.4.2 @capacitor/assets@3.0.5
```

Expected: `package.json` and `pnpm-lock.yaml` contain Capacitor `8.4.2`; no Android code exists yet.

- [ ] **Step 2: Write the failing runtime-detection test**

Create `src/platform/runtime.test.ts`:

```ts
import { describe, expect, test, vi } from "vitest";
import { createPlatformRuntime } from "./runtime";

describe("PlatformRuntime", () => {
  test.each([
    [true, "android", true],
    [true, "ios", false],
    [false, "android", false],
    [false, "web", false],
  ] as const)("native=%s platform=%s returns %s", (native, platform, expected) => {
    const capacitor = {
      isNativePlatform: vi.fn(() => native),
      getPlatform: vi.fn(() => platform),
    };
    expect(createPlatformRuntime(capacitor).isNativeAndroid()).toBe(expected);
  });
});
```

- [ ] **Step 3: Run the runtime test and verify RED**

Run: `pnpm test:run src/platform/runtime.test.ts`

Expected: FAIL because `src/platform/runtime.ts` does not exist.

- [ ] **Step 4: Implement the runtime boundary**

Create `src/platform/runtime.ts`:

```ts
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
```

- [ ] **Step 5: Add the fixed Capacitor configuration**

Create `capacitor.config.ts`:

```ts
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
```

Do not add a `server` property.

- [ ] **Step 6: Generate and normalize the Android shell**

Run:

```powershell
pnpm build
pnpm exec cap add android
pnpm exec cap sync android
```

Then set `minSdkVersion = 29`, `compileSdkVersion = 36`, and `targetSdkVersion = 36` in `android/variables.gradle`. Confirm the wrapper URL in `android/gradle/wrapper/gradle-wrapper.properties` ends in `gradle-8.14.3-all.zip`.

- [ ] **Step 7: Generate Android icons from the existing app asset**

Copy `public/icons/icon-512.png` to `resources/icon-only.png`, then run:

```powershell
pnpm exec capacitor-assets generate --android
```

Expected: Android mipmap and adaptive-icon resources use the existing 7S icon rather than the Capacitor default.

- [ ] **Step 8: Verify Task 1**

Run:

```powershell
pnpm test:run src/platform/runtime.test.ts
pnpm build
pnpm exec cap sync android
```

Expected: runtime tests pass, Vite builds, and `android/app/src/main/assets/public/index.html` exists.

Review checkpoint: verify package id, app name, SDK floors, local `webDir`, icon resources, and absence of `server.url`.

---

### Task 2: Browser-Compatible File Output And Native Chunk Transfer

**Files:**
- Create: `src/platform/fileOutput.ts`
- Create: `src/platform/fileOutput.test.ts`
- Create: `src/platform/nativeFileTransfer.ts`
- Modify: `src/features/reports/reportOutput.ts`
- Modify: `src/features/reports/reportOutput.test.ts`

**Interfaces:**
- Produces: `FileOutputPort.save(blob, filename): Promise<FileSaveResult>`.
- Produces: `FileOutputPort.share(blob, filename): Promise<ReportOutputResult>`.
- Produces: `NativeFileTransferPlugin` with `beginTransfer`, `appendChunk`, `saveToDownloads`, `share`, and `abortTransfer`.
- Consumes: `PlatformRuntime.isNativeAndroid()` from Task 1.

- [ ] **Step 1: Write failing tests for web fallback and native chunking**

Create `src/platform/fileOutput.test.ts` with real Blob input and a fake native plugin:

```ts
import { expect, test, vi } from "vitest";
import { createFileOutput, NATIVE_CHUNK_BYTES } from "./fileOutput";

test("browser save keeps anchor-download behavior", async () => {
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  const output = createFileOutput({ runtime: { isNativeAndroid: () => false } });
  await expect(output.save(new Blob(["docx"]), "巡检通报.docx")).resolves.toMatchObject({
    status: "saved",
    filename: "巡检通报.docx",
  });
  expect(click).toHaveBeenCalledOnce();
});

test("native save sends bounded chunks and finishes in Downloads", async () => {
  const native = {
    beginTransfer: vi.fn().mockResolvedValue({ transferId: "transfer-1" }),
    appendChunk: vi.fn().mockResolvedValue(undefined),
    saveToDownloads: vi.fn().mockResolvedValue({
      filename: "巡检通报.docx",
      location: "下载/7S巡检",
    }),
    share: vi.fn(),
    abortTransfer: vi.fn(),
  };
  const blob = new Blob([new Uint8Array(NATIVE_CHUNK_BYTES * 2 + 7)]);
  const output = createFileOutput({
    runtime: { isNativeAndroid: () => true },
    native,
  });
  await output.save(blob, "巡检通报.docx");
  expect(native.appendChunk).toHaveBeenCalledTimes(3);
  expect(native.saveToDownloads).toHaveBeenCalledWith({ transferId: "transfer-1" });
});

test("native transfer aborts its temporary file after an append failure", async () => {
  const native = {
    beginTransfer: vi.fn().mockResolvedValue({ transferId: "transfer-1" }),
    appendChunk: vi.fn().mockRejectedValue(new Error("write failed")),
    saveToDownloads: vi.fn(),
    share: vi.fn(),
    abortTransfer: vi.fn().mockResolvedValue(undefined),
  };
  const output = createFileOutput({
    runtime: { isNativeAndroid: () => true },
    native,
  });
  await expect(output.save(new Blob(["data"]), "失败.docx")).rejects.toThrow("文件保存失败");
  expect(native.abortTransfer).toHaveBeenCalledWith({ transferId: "transfer-1" });
});
```

Include additional tests for native share, browser Web Share cancellation, unavailable Web Share, empty Blob, and Unicode filenames.

- [ ] **Step 2: Run file-output tests and verify RED**

Run: `pnpm test:run src/platform/fileOutput.test.ts src/features/reports/reportOutput.test.ts`

Expected: FAIL because the new file-output API does not exist.

- [ ] **Step 3: Define the native plugin contract**

Create `src/platform/nativeFileTransfer.ts`:

```ts
import { registerPlugin } from "@capacitor/core";

export interface NativeFileTransferPlugin {
  beginTransfer(options: { filename: string; mimeType: string }): Promise<{ transferId: string }>;
  appendChunk(options: { transferId: string; chunkBase64: string }): Promise<void>;
  saveToDownloads(options: { transferId: string }): Promise<{ filename: string; location: string }>;
  share(options: { transferId: string }): Promise<void>;
  abortTransfer(options: { transferId: string }): Promise<void>;
}

export const NativeFileTransfer = registerPlugin<NativeFileTransferPlugin>("SevenSFileTransfer");
```

- [ ] **Step 4: Implement bounded Blob transfer and web fallback**

Create `src/platform/fileOutput.ts` with:

```ts
export const NATIVE_CHUNK_BYTES = 256 * 1024;

export interface FileSaveResult {
  status: "saved";
  filename: string;
  location: string | null;
}

export interface FileOutputPort {
  save(blob: Blob, filename: string): Promise<FileSaveResult>;
  share(blob: Blob, filename: string): Promise<ReportOutputResult>;
}
```

Implement `blobSliceToBase64` by reading one `blob.slice(offset, end).arrayBuffer()` at a time and converting bytes in 32 KiB sub-batches before `btoa`. Implement one private `transferBlob` function that always calls `abortTransfer` after any begin/append/finalize failure. Reject empty or unsafe filenames before beginning a native transfer. Map native error codes to concise Chinese errors while preserving the original code for logging.

For browser save, retain object-URL anchor download and deferred URL revocation. For browser share, retain `navigator.canShare` and `navigator.share` behavior.

- [ ] **Step 5: Keep reportOutput as a compatibility facade**

Refactor `src/features/reports/reportOutput.ts` so existing imports delegate to the browser branch of `FileOutputPort`. Keep `ReportOutputResult = "shared" | "cancelled" | "unavailable"`. Change `downloadReport` to return `Promise<FileSaveResult>` so UI code can show success or failure accurately.

- [ ] **Step 6: Verify Task 2**

Run:

```powershell
pnpm test:run src/platform/fileOutput.test.ts src/features/reports/reportOutput.test.ts
pnpm exec tsc -b --pretty false
```

Expected: all focused tests pass; TypeScript reports no errors.

Review checkpoint: inspect bounded memory behavior, abort-on-error, Unicode filenames, browser compatibility, and absence of full-Blob base64 conversion.

---

### Task 3: Android MediaStore And Share Plugin

**Files:**
- Create: `android/app/src/main/java/com/xiangtang/sevensinspection/SevenSFileTransferPlugin.java`
- Create: `android/app/src/main/java/com/xiangtang/sevensinspection/DownloadNameResolver.java`
- Modify: `android/app/src/main/java/com/xiangtang/sevensinspection/MainActivity.java`
- Modify: `android/app/src/main/AndroidManifest.xml`
- Create: `android/app/src/main/res/xml/file_paths.xml`
- Create: `android/app/src/test/java/com/xiangtang/sevensinspection/DownloadNameResolverTest.java`

**Interfaces:**
- Implements the `SevenSFileTransfer` Capacitor plugin declared in Task 2.
- Writes completed save transfers to `MediaStore.Downloads` under `Download/7S巡检`.
- Shares a cache file through `${applicationId}.fileprovider` and `ACTION_SEND`.

- [ ] **Step 1: Write the failing Java filename tests**

Create `DownloadNameResolverTest.java`:

```java
package com.xiangtang.sevensinspection;

import static org.junit.Assert.assertEquals;
import org.junit.Test;

public class DownloadNameResolverTest {
  @Test public void keepsUnusedName() {
    assertEquals("巡检通报.docx", DownloadNameResolver.candidate("巡检通报.docx", 1));
  }

  @Test public void addsCounterBeforeExtension() {
    assertEquals("巡检通报 (2).docx", DownloadNameResolver.candidate("巡检通报.docx", 2));
  }

  @Test public void handlesNameWithoutExtension() {
    assertEquals("备份 (3)", DownloadNameResolver.candidate("备份", 3));
  }
}
```

- [ ] **Step 2: Run native unit test and verify RED**

Run: `android\gradlew.bat testDebugUnitTest --tests "*DownloadNameResolverTest"`

Expected: FAIL because `DownloadNameResolver` does not exist.

- [ ] **Step 3: Implement filename resolution**

Create `DownloadNameResolver.java` as a package-private final utility. `candidate(name, 1)` returns the original name; later candidates insert ` (n)` before the final extension. Reject path separators, NUL, blank names, and names longer than 180 Unicode code units in the plugin before calling this utility.

- [ ] **Step 4: Implement chunk transfer sessions**

Create `SevenSFileTransferPlugin.java` with `@CapacitorPlugin(name = "SevenSFileTransfer")`. Maintain a thread-safe `ConcurrentHashMap<String, TransferSession>` where each session contains the temporary file, original filename, MIME type, and last-access time.

Method behavior:

```java
@PluginMethod beginTransfer(PluginCall call)
@PluginMethod appendChunk(PluginCall call)
@PluginMethod saveToDownloads(PluginCall call)
@PluginMethod share(PluginCall call)
@PluginMethod abortTransfer(PluginCall call)
```

- `beginTransfer` creates a UUID-named file below `cacheDir/seven-s-transfer` and returns the UUID.
- `appendChunk` decodes only the supplied base64 chunk with `Base64.NO_WRAP` and appends it to the temporary file.
- `saveToDownloads` queries `MediaStore.Downloads` for collisions in relative path `Download/7S巡检`, chooses the first free `DownloadNameResolver` candidate, inserts with `IS_PENDING=1`, streams the temporary file through `ContentResolver`, then sets `IS_PENDING=0` and deletes the transfer session.
- `share` exposes the temporary file with `FileProvider.getUriForFile`, launches an `ACTION_SEND` chooser with `FLAG_GRANT_READ_URI_PERMISSION`, and removes the in-memory session while leaving the cache file for Android cache cleanup.
- `abortTransfer` removes and deletes the temporary file idempotently.
- On plugin load, delete transfer cache files older than 24 hours.
- Use error codes `INVALID_ARGUMENT`, `TRANSFER_NOT_FOUND`, `STORAGE_FULL`, `SAVE_FAILED`, and `SHARE_FAILED` in `PluginCall.reject`.
- Never request or use broad external-storage permissions.

- [ ] **Step 5: Register the plugin and FileProvider**

In `MainActivity.onCreate`, call `registerPlugin(SevenSFileTransferPlugin.class)` after `super.onCreate(savedInstanceState)`.

Add to `AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.CAMERA" />
```

Inside `<application>`, add a non-exported `androidx.core.content.FileProvider` using authority `${applicationId}.fileprovider`, URI grant permission, and `@xml/file_paths`. Create `file_paths.xml` with only:

```xml
<paths xmlns:android="http://schemas.android.com/apk/res/android">
    <cache-path name="seven_s_transfer" path="seven-s-transfer/" />
</paths>
```

- [ ] **Step 6: Verify Task 3**

Run:

```powershell
android\gradlew.bat testDebugUnitTest
android\gradlew.bat lintDebug
android\gradlew.bat assembleDebug
```

Expected: Java tests, Android lint, and debug compilation pass.

Review checkpoint: inspect URI scope, MediaStore pending cleanup, collision behavior, path traversal rejection, temporary-file cleanup, and absence of broad storage permissions.

---

### Task 4: Word, Backup, And PWA UI Integration

**Files:**
- Modify: `src/app/dependencies.ts`
- Modify: `src/features/review/ReviewPage.tsx`
- Modify: `src/features/review/ReviewPage.test.tsx`
- Modify: `src/features/settings/BackupPage.tsx`
- Modify: `src/features/settings/BackupPage.test.tsx`
- Modify: `src/app/PwaRoot.tsx`
- Create: `src/app/PwaRoot.test.tsx`
- Modify: `src/test/renderWithRouter.tsx`

**Interfaces:**
- Adds `fileOutput: FileOutputPort` to `AppDependencies`.
- Report generator delegates save/share to the same `FileOutputPort`.
- Backup export saves through `FileOutputPort` instead of importing a browser-only helper.

- [ ] **Step 1: Write failing UI tests**

In `ReviewPage.test.tsx`, extend the existing successful-generation fixture with `dependencies.fileOutput.save`. Resolve it as `{ status: "saved", filename: generatedFilename, location: "下载/7S巡检" }`, click `下载Word`, await the promise, and assert that the status text is `Word已保存到下载/7S巡检。`. Add a rejection case with `new Error("手机存储空间不足。")`; assert the generated report buttons remain available after the alert so save or share can be retried.

In `BackupPage.test.tsx`, replace the anchor-spy expectation in the export test with a deferred `dependencies.fileOutput.save`. Assert that export controls remain disabled until both ZIP creation and file save settle, that the exact timestamped ZIP filename is passed to `save`, and that a rejected save restores the enabled button and displays the error without discarding local data.

In `PwaRoot.test.tsx`, mock `virtual:pwa-register/react` to return `needRefresh: [true]`, render `<PwaRoot runtime={{ isNativeAndroid: () => true }} />`, and assert that no `立即更新` button exists. Render again with `isNativeAndroid: () => false` and assert that the update button is visible. Make `PwaRoot` accept an optional `runtime: PlatformRuntime` prop defaulting to `browserPlatformRuntime`, so this test does not mutate Capacitor globals.

Retain existing share cancellation, repeated-click blocking, and route-change stale-result tests.

- [ ] **Step 2: Run focused UI tests and verify RED**

Run:

```powershell
pnpm test:run src/features/review/ReviewPage.test.tsx src/features/settings/BackupPage.test.tsx src/app/PwaRoot.test.tsx
```

Expected: FAIL because `fileOutput` is not yet injected and native PWA suppression is absent.

- [ ] **Step 3: Inject one shared FileOutputPort**

In `createAppDependencies`, construct one `createFileOutput({ runtime: browserPlatformRuntime, native: NativeFileTransfer })`. Expose it as `fileOutput`, and have `reportGenerator.downloadReport` and `reportGenerator.shareOrDownloadReport` delegate to it. Extend dependency test fixtures so they can inject a fake port without mocking Capacitor globals.

- [ ] **Step 4: Make Word save asynchronous and truthful**

Add `saveGeneratedReport()` in `ReviewPage`. Disable the save/share buttons while their operation is pending. Await `fileOutput.save`; on success show `Word已保存到下载/7S巡检。` when a native location is returned, otherwise retain the browser handoff message. On failure keep `generatedReport` intact and show the mapped error so the user can retry or share.

Do not change report generation status or regenerate the DOCX when output alone fails.

- [ ] **Step 5: Route ZIP export through FileOutputPort**

Replace `downloadBackup` use in `BackupPage` with `await fileOutput.save(blob, backupFilename(now()))`. Keep the existing pending-action guard. Report the Downloads location on native success and retain browser wording when location is null. Preserve `<input type="file">` ZIP restore behavior.

- [ ] **Step 6: Suppress service-worker UI in native Android**

Keep `useRegisterSW` unconditional in `PwaRoot`, but pass `needRefresh={false}` to `PwaUpdatePrompt` when `runtime.isNativeAndroid()` is true. Do not conditionally call hooks.

- [ ] **Step 7: Verify Task 4**

Run:

```powershell
pnpm test:run src/features/review/ReviewPage.test.tsx src/features/settings/BackupPage.test.tsx src/app/PwaRoot.test.tsx src/platform/fileOutput.test.ts
pnpm exec tsc -b --pretty false
pnpm lint
```

Expected: focused tests, TypeScript, and lint pass.

Review checkpoint: verify retry behavior, stale async-result protection, no false success, unchanged browser behavior, and no conditional React hooks.

---

### Task 5: Reproducible Android Toolchain And APK Build

**Files:**
- Create: `scripts/setup-android.ps1`
- Create: `scripts/build-android.ps1`
- Create: `scripts/verify-apk.mjs`
- Modify: `package.json`
- Modify: `.gitignore`
- Modify: `README.md`

**Interfaces:**
- Produces: `pnpm android:sync` and `pnpm android:apk` commands.
- Produces: `artifacts/7S巡检-个人试用版.apk`.
- Produces: a verification script that fails on missing local assets or forbidden server URLs.

- [ ] **Step 1: Write the failing APK package verifier**

Create `scripts/verify-apk.mjs` to accept one APK path, open it with `fflate`, and assert:

- `assets/public/index.html` exists.
- at least one `assets/public/assets/*.js` entry exists.
- `assets/public/index.html` references relative assets.
- decoded text entries do not contain `127.0.0.1:4175`, `192.168.`, or a Capacitor `server.url`.
- `AndroidManifest.xml`, `classes.dex`, and app icon resources exist.

Exit nonzero with a precise message for every failed assertion.

- [ ] **Step 2: Run the verifier and verify RED**

Run: `node scripts/verify-apk.mjs artifacts/7S巡检-个人试用版.apk`

Expected: FAIL because the APK artifact does not exist.

- [ ] **Step 3: Add reproducible environment setup**

Create `scripts/setup-android.ps1` that:

1. Locates or installs Android Studio with `winget install --id Google.AndroidStudio --exact --accept-package-agreements --accept-source-agreements`.
2. Sets `JAVA_HOME` to Android Studio's bundled `jbr` directory for the current process.
3. If SDK Manager is absent, downloads Google's fixed command-line tools archive `https://dl.google.com/android/repository/commandlinetools-win-13114758_latest.zip`, verifies that the archive contains `cmdline-tools/bin/sdkmanager.bat`, and installs it below `%LOCALAPPDATA%\Android\Sdk\cmdline-tools\latest`.
4. Uses SDK Manager below `%LOCALAPPDATA%\Android\Sdk\cmdline-tools\latest\bin`.
5. Installs `platform-tools`, `platforms;android-36`, and `build-tools;36.0.0`.
6. Accepts Android SDK licenses non-interactively and stops on any rejected command.
7. Prints resolved Java, SDK Manager, ADB, and SDK package versions.

The script must be idempotent and must not delete an existing SDK.

- [ ] **Step 4: Add the APK build script**

Create `scripts/build-android.ps1` with `$ErrorActionPreference = "Stop"`. It must:

1. Resolve the same JDK and `ANDROID_HOME` as setup.
2. Run `pnpm build`.
3. Run `pnpm exec cap sync android`.
4. Run `android\gradlew.bat testDebugUnitTest lintDebug assembleDebug`.
5. Copy `android/app/build/outputs/apk/debug/app-debug.apk` to `artifacts/7S巡检-个人试用版.apk`.
6. Run `node scripts/verify-apk.mjs` against the copied artifact.
7. Print the final absolute path, byte size, and SHA-256 hash.

- [ ] **Step 5: Add package scripts and ignore generated artifacts**

Add:

```json
{
  "android:setup": "powershell -ExecutionPolicy Bypass -File scripts/setup-android.ps1",
  "android:sync": "pnpm build && cap sync android",
  "android:apk": "powershell -ExecutionPolicy Bypass -File scripts/build-android.ps1"
}
```

Ignore `artifacts/*.apk`, Android build directories, and local SDK/log output, but do not ignore the `android/` source project.

- [ ] **Step 6: Document installation and backup warnings**

Update `README.md` with exact commands, APK path, Android “允许安装未知应用” steps, offline cold-start steps, and the warning that uninstalling or clearing app data removes IndexedDB. Explain that the personal debug signature must remain unchanged for in-place upgrades.

- [ ] **Step 7: Build and verify Task 5**

Run:

```powershell
pnpm android:setup
pnpm android:apk
```

Expected: Android tools resolve, Gradle tests/lint/build pass, verifier passes, and the APK plus SHA-256 are printed.

Review checkpoint: independently inspect build logs, APK contents, manifest permissions, package id, app label, and artifact hash.

---

### Task 6: Full Regression And Handoff

**Files:**
- Modify: `.superpowers/sdd/progress.md`
- Inspect only: `artifacts/7S巡检-个人试用版.apk`

**Interfaces:**
- Consumes all previous tasks.
- Produces the verified APK path, checksum, installation instructions, and an explicit true-device test checklist.

- [ ] **Step 1: Run fresh web verification**

Run sequentially:

```powershell
pnpm exec tsc -b --pretty false
pnpm lint
pnpm test:run
pnpm build
$env:PLAYWRIGHT_CHROME_EXECUTABLE_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
pnpm test:e2e
```

Expected: TypeScript, lint, every Vitest file, production build, and all 14 mobile E2E tests pass.

- [ ] **Step 2: Run fresh Android verification**

Run:

```powershell
android\gradlew.bat testDebugUnitTest lintDebug assembleDebug
node scripts/verify-apk.mjs artifacts/7S巡检-个人试用版.apk
Get-FileHash -Algorithm SHA256 -LiteralPath 'artifacts\7S巡检-个人试用版.apk'
```

Expected: Gradle exits zero, APK verifier exits zero, and SHA-256 is reported.

- [ ] **Step 3: Request independent final review**

Give the reviewer the confirmed design, this plan, all changed source/config/native files, test output, APK verifier output, and hash. Fix every Critical or Important finding with a new failing test before proceeding.

- [ ] **Step 4: Re-run affected and full verification after review fixes**

Any code fix invalidates previous evidence. Repeat Steps 1 and 2 after the last source change.

- [ ] **Step 5: Record final status and hand off**

Update `.superpowers/sdd/progress.md` with task-level test evidence. Give the user:

- a clickable absolute APK path;
- SHA-256;
- Android installation steps;
- reminder to allow camera permission;
- reminder that uninstalling clears local data;
- the eight-step true-device acceptance list from the design.

Do not claim actual camera, WPS, Downloads, or offline cold-start success until the user performs those checks on a physical Android phone; distinguish automated APK verification from true-device acceptance.
