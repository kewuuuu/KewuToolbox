# KewuToolbox Browser Bridge

用于把浏览器标签页域名同步到 `KewuToolbox`。

规则：

- 只识别 URL 的域名（例如 `https://www.bilibili.com/xxx` -> `bilibili.com`）
- 忽略路径、参数、锚点
- 同域名多个标签页算同一事项（覆盖关系，不重复累计）

## 安装（开发者模式）

1. 打开 `chrome://extensions` 或 `edge://extensions`
2. 打开“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择本目录 `browser-extension`

## 本地接口

扩展只向本机发送数据：

`http://127.0.0.1:17321/browser-bridge`
