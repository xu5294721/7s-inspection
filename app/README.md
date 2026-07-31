# 7S 移动巡检 PWA

本应用用于向塘钢轨焊接整修车间现场 7S 巡检。巡检草稿、照片、模板和设置保存在当前浏览器本地，不依赖业务 API 服务器。

## 本地运行

环境要求：Node.js 24、pnpm 11.9.0。

```powershell
pnpm install --frozen-lockfile
pnpm dev
pnpm test:run
pnpm test:stress
pnpm lint
pnpm build
pnpm exec vite preview --host 127.0.0.1 --port 4174
pnpm test:e2e
```

开发服务器用于日常开发。安装、Service Worker 和离线恢复应通过 `pnpm build` 后的生产预览或 HTTPS 部署地址验证。

Playwright 默认使用随 Playwright 安装的 Chromium。仅当本机无法取得 bundled Chromium 时，才显式指定一个已安装的 Chrome/Chromium 可执行文件；配置会校验路径是否存在：

```powershell
$env:PLAYWRIGHT_CHROME_EXECUTABLE_PATH='C:\Program Files\Google\Chrome\Application\chrome.exe'
pnpm test:e2e
```

## 静态部署

项目使用相对基础路径 `./`，可部署在 GitHub Pages 仓库子路径。推送到 `main` 或手动运行 `Deploy 7S PWA to GitHub Pages` 工作流时，CI 会在 `app` 目录执行冻结安装、单元测试、检查和构建，只上传 `app/dist`，随后发布到 Pages。原始 DOCX、工作区文件和浏览器本地数据不会进入部署产物。

## Android Chrome 安装

1. 使用 Android Chrome 打开 HTTPS 部署地址，等待首页完整加载。
2. 点击浏览器菜单，选择“添加到主屏幕”或“安装应用”。
3. 确认名称为“7S巡检”并完成安装。
4. 从主屏幕图标启动，确认以独立应用窗口显示。

不同手机或 Chrome 版本的菜单名称可能略有差异。首次离线使用前，至少在线完整打开一次应用并等待 Service Worker 安装完成。

## 本地数据与备份

所有巡检记录、照片和模板仅保存在当前浏览器的 IndexedDB 中，不会自动同步到其他手机、电脑或浏览器。清除网站数据、卸载浏览器、系统清理存储或更换设备都可能造成数据丢失。

进入“设置 > 数据备份与恢复”，定期导出 ZIP 备份并保存到设备外的可靠位置。恢复前先核对备份文件；恢复操作会按页面确认内容替换当前本地数据。重要通报生成后应及时备份，并在实际设备上完成一次清除和恢复演练。

## Word 下载与分享

复核页生成 Word 后，可点击“分享Word”调用设备文件分享能力，或点击“下载Word”保存 `.docx` 文件。若浏览器不支持文件分享、用户取消分享或分享失败，文件仍可通过“下载Word”保存，再使用 Android WPS、Windows WPS 或 Microsoft Word 打开。实际排版、中文文件名和 2/3 张照片布局须在目标办公软件中验收。
