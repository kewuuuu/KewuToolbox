# KewuToolbox Browser Bridge

用于把浏览器标签页对象通过统一插件协议同步到 `KewuToolbox`。

规则：

- 先请求桌面端匹配黑白名单规则（名称/类型/进程，支持通配符）。
- 黑名单命中：该标签页不再上报。
- 白名单命中：按白名单规则名归并上报，记录键使用桌面端统一的 `process-whitelist|规则ID`。
- 同一标签页命中多条白名单时，会同时上报多个记录键，并通过 `focusedClassificationKeys` 让焦点时长同时计入这些白名单项。
- 未命中黑白名单：按域名归并上报。
- 上报抑制规则，用于抑制原生浏览器 `AppWindow` 记录。
- 由桌面端进行白名单/黑名单/分类等后续处理。

## 安装（开发者模式）

1. 打开 `chrome://extensions` 或 `edge://extensions`
2. 打开“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择本目录 `browser-extension`

## 本地接口

扩展只向本机发送数据：

`http://127.0.0.1:17321/plugin-bridge`

## 版本兼容

插件版本不跟随 KewuToolbox 主程序版本自动同步。兼容范围见本目录的 `COMPATIBILITY.md`。
