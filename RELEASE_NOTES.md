# 林虎 · DSH 桌宠 v1.0.0

Windows x64 便携版。解压即用，不需要安装 Node.js 或 DeepSeek Harness，但只有本机存在 DSH 会话日志时才会显示 token 数据。

## 下载

| 文件 | 用途 |
|---|---|
| `LinhuPet-Windows-x64-v1.0.0.zip` | 可直接运行的桌宠（推荐普通用户） |
| `LinhuPet-Source-v1.0.0.zip` | 源码、构建脚本、安装/卸载脚本（开发者） |
| `SHA256SUMS.txt` | 两个压缩包的 SHA-256 校验值 |

## 运行

1. 把 `LinhuPet-Windows-x64-v1.0.0.zip` 解压到任意目录；
2. 进入 `LinhuPet` 文件夹；
3. 双击 `LinhuPet.exe` 或 `启动林虎桌宠.bat`。

**不要把 `LinhuPet.exe` 单独拖出来运行**，`resources/`、`locales/` 和 DLL 必须与它同级。

Windows SmartScreen 提示时，选择「更多信息 → 仍要运行」。

## 功能

- Q 版林虎趴在垫子上，透明、无边框、始终置顶
- 今日 token 总吞吐、输入/输出、请求次数、缓存命中率
- 本会话 token、上下文占用百分比和进度条
- 打盹 / 思考 / 跑命令 / 等待确认 / 完成 / 出错状态气泡
- 拖拽移动，拖拽时整只虎和垫子晃动、冒汗滴；贴边吸附；位置记忆
- 面板可收起为「今日 tokens」小胶囊
- 托盘菜单：显示/隐藏、置顶、刷新、重置到右上/右下、开机启动、退出
- 「打开 DSH」把正在运行的 DeepSeek Harness 窗口切到前台

## 数据

只读取本机 `%USERPROFILE%\.dsh\sessions` 下的 DSH 会话日志（支持多帧 zstd），不联网、不上传日志或凭据。

- 今日 tokens 包含缓存读取；输入/输出和缓存命中率在面板中单独显示
- 配置和窗口位置保存在 `%APPDATA%\LinhuPet`
- 刷新间隔约 1.4 秒

## 卸载 / 删除

### 便携版

1. 托盘右键 → 退出；
2. 删除解压出来的 `LinhuPet` 文件夹；
3. 可选：删除 `%APPDATA%\LinhuPet`，连同配置和缓存一起清理。

### 安装版（如果使用过 `install.ps1`）

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\uninstall.ps1
```

连配置一起删除：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\uninstall.ps1 -RemoveData
```

安装脚本只写当前用户目录和两个快捷方式；卸载脚本会同时清理可能存在的开机启动项。

## 已知限制

- 仅 Windows 10/11 x64。
- 使用 DSH 自带 Electron 运行时的副本打包，所以压缩包约 150 MB（解压后约 369 MB）。
- 今日统计包含缓存读取，数字会比「计费输入 + 输出」大很多。
- 桌宠窗口透明但不穿透，空白区域点击不会落到桌面。
- 「打开 DSH」依赖 DSH 窗口的进程名；找不到时会回退打开本地 Web 地址。

## 版权

非官方同人作品，与 DeepSeek、Nekojishi 开发组及林虎权利方无隶属关系。

- 源代码：MIT，见 `LICENSE`
- 林虎 / 《家有大猫》角色和参考图：版权归原权利方，禁止商用；公开发布前请确认授权
- Electron：MIT；完整许可见 `LICENSE.electron.txt` 和 `LICENSES.chromium.html`
- 随包 Electron 运行时来自 DeepSeek Harness Desktop，DeepSeek Harness 及其标识归 DeepSeek

详见 `THIRD_PARTY_NOTICES.md`。

## GitHub 发布提示（给仓库维护者）

- **不要把 369MB 的 exe 或 zip 提交进 git 仓库**。GitHub 普通文件限制 100MB，请把 `LinhuPet-Windows-x64-v1.0.0.zip` 作为 **Release asset** 上传。
- 源码仓库只提交根目录脚本、`linhu-pet/`、`scripts/`、`docs/`、README、LICENSE 和 notices；`dist/` 已在 `.gitignore` 中忽略。
- 建议 release tag：`v1.0.0`。
- 上传前再次确认角色图片和 DSH Electron 运行时的再分发授权。
