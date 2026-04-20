# KewuToolbox Browser Bridge

用于把浏览器标签页对象通过统一插件协议同步到 `KewuToolbox`。

规则：

- 上报标签页记录（`BrowserTab`）及当前焦点标签。
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
