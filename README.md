# 7S 巡检管理

面向现场 7S 日常巡检的离线移动端工具，服务于检查记录、通报复核和 Word 通报生成，减少现场拍照后再整理材料的工作量。

当前版本：[v1.1.18](https://github.com/xu5294721/7s-inspection/releases/tag/v1.1.18)。支持网页/PWA 和 Android APK 两种使用方式。

## 主要功能

- 巡检路线模板：选择固定项点，也可新建模板、增加自定义项点并调整顺序。
- 现场检查：每个项点可拍照或从相册选择照片；也可不拍照，直接填写检查内容和评价。
- 检查内容模板：在“设置 > 检查内容模板”中维护检查大项、小项和默认选项；支持按具体检查项点设置覆盖模板。
- 按需选择检查内容：打开检查内容时，各大项均为“未选择”；点击某个大项后才自动带出该大项的默认小项，其余大项保持未选择。
- 评价管理：支持“好的方面”“一般表现”“提醒问题”“考核问题”四类评价；考核问题可填写责任人员、金额，并可选择转入后续整改追踪。
- 照片与评价：先选择评价类别再拍照或从相册添加照片时，照片会保留在原评价组中，不会重复生成“好的方面”评价。
- 通报复核：统一复核有照片和无照片的评价内容，可修改项点、文字、分类及分类内排序。
- 巡检历史：按“待继续巡检”（未生成 Word 的草稿）与“已完成”（已生成 Word）两个分区展示，待继续在上、已完成在下。
- Word 通报：一键生成 `.docx` 文件；有内容的无照片项同样会写入对应章节。支持固定或自适应照片排版，自适应模式下单张照片可占满一行。
- 本地备份与恢复：导出 ZIP 备份并恢复巡检记录、原图、缩略图、路线模板、检查内容模板和设置；Android 导出采用分块写入，适合照片较多的备份。
- Android 文件保存：生成的 Word 和 ZIP 备份可保存到手机“下载”目录，便于使用 WPS 或 Word 打开、分享。

## 使用流程

1. 在“巡检”中选择路线模板并开始检查。
2. 逐项拍照，或直接选择检查内容和评价类别；没有照片的评价也可正常保存。
3. 点击“检查内容”，按需选择检查大项及对应小项；首次点击某一大项时会带出该大项的默认小项。
4. 完成检查后进入“通报复核”，核对文字、照片和分类排序。
5. 在“设置 > Word 模板设置”中调整照片排版后，生成并下载或分享 Word 通报。
6. 定期在“设置 > 备份与存储”导出 ZIP 备份。

## Android 安装

从 [v1.1.18 Release](https://github.com/xu5294721/7s-inspection/releases/tag/v1.1.18) 下载 APK，传至 Android 手机后，在“下载”目录中点击安装。如系统提示，请仅对所使用的文件管理器授权“允许安装未知应用”。

### 签名与升级注意事项

手机上已安装的版本使用“原打包电脑”的调试密钥签名。不同密钥签名的 APK 之间**不能覆盖安装**：

- **覆盖升级（保留数据）**：使用原打包电脑构建的 `app-debug.apk`（见下方“Android 打包”）。同密钥且版本号更高时，可直接覆盖安装，巡检数据全部保留。
- **全新安装**：Release 中的 `newkey` 后缀 APK 使用新密钥签名，仅适合新手机；安装在旧手机前必须先卸载旧版，卸载会清空本地数据，务必先导出 ZIP 备份。

安装后可离线使用。建议首次使用后立即导出一次 ZIP 备份，并在每次形成重要通报后再次备份。

## 数据与备份

巡检记录、照片、路线模板、检查内容模板及 Word 设置均默认保存于当前设备本地，应用不会自动同步到其他手机或电脑。

请勿随意清除应用数据、卸载应用或使用系统清理工具。更换设备前，应先导出 ZIP 备份，并在新设备中导入恢复。恢复时请先核对备份内容，再按实际需要选择合并或替换本地数据。

## 项目结构

- `app/`：网页、PWA 和 Android Capacitor 工程源码。
- `output/`：本地生成的 APK 文件，不上传到仓库。
- `docs/`：项目设计与开发资料。

## 本地开发

进入 `app` 目录后执行：

```powershell
pnpm install --frozen-lockfile
pnpm test:run
pnpm lint
pnpm build
```

## Android 打包

环境要求：JDK 21、Android SDK（platform 36、build-tools 36.0.0），并设置 `JAVA_HOME` 与 `ANDROID_HOME`。先在 `app` 目录完成 `pnpm build`，再执行 `pnpm exec cap sync android` 同步 Web 资源，然后在 `app/android` 目录打包：

```powershell
.\gradlew.bat assembleDebug    # 调试签名 APK，输出 app\build\outputs\apk\debug\app-debug.apk
.\gradlew.bat assembleRelease  # 正式签名 APK，输出 app\build\outputs\apk\release\app-release.apk
```

正式签名通过用户全局 Gradle 属性（`~/.gradle/gradle.properties` 中的 `sevenSReleaseStoreFile`、`sevenSReleaseStorePassword`、`sevenSReleaseKeyAlias`、`sevenSReleaseKeyPassword`）配置，密钥库文件不进仓库；未配置这些属性时 release 构建为未签名包。Gradle 下载缓慢时可将 `gradle/wrapper/gradle-wrapper.properties` 中的 distributionUrl 临时替换为镜像地址。

本项目用于内部现场管理。仓库不包含巡检原始材料、照片、Word 通报、备份数据或个人工作资料。
