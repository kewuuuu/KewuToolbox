# KewuToolbox VSCode 工作区桥接插件

该插件会把 VSCode 当前窗口识别为“工作区对象”并上报到 KewuToolbox：

- 名称格式：`工作区名 - Visual Studio Code`
- 同一窗口切换工作区后，会按新的工作区识别为不同对象
- 使用统一插件桥接协议：`http://127.0.0.1:17321/plugin-bridge`

## 本地加载（开发模式）

1. 在 VSCode 中打开命令面板，执行 `Developer: Install Extension from Location...`
2. 选择本目录 `vscode-extension`
3. 安装后重载窗口

## 行为说明

- 插件会周期上报当前工作区记录（默认 1 秒）
- 上报前会请求桌面端黑白名单匹配：
  - 命中黑名单：不上报该工作区
  - 命中白名单：按白名单规则名归并上报，记录键使用桌面端统一的 `process-whitelist|规则ID`
  - 命中多条白名单：通过 `focusedClassificationKeys` 同时上报多个焦点记录键
  - 都未命中：按工作区维度上报
- 同时上报 `suppressRules`，抑制原生 `code.exe` 窗口重复计入

## 版本兼容

插件版本不跟随 KewuToolbox 主程序版本自动同步。兼容范围见本目录的 `COMPATIBILITY.md`。
