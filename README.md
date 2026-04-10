# Mindful Desktop

一个仅 Windows 使用的本地效率工具，包含：

- 番茄钟与专注队列
- 焦点窗口统计
- 打开窗口时长统计
- 开关机/锁屏/恢复事件记录
- 待办与归档

## 架构

- 前端：`React + Vite + TypeScript + shadcn/ui`
- 桌面壳：`Electron`
- 系统监控：`active-win` + Electron `powerMonitor`
- 浏览器域名识别：`browser-extension`（Chrome/Edge 插件）
- 本地数据存储：`%AppData%/<应用目录>/app-state.json`

说明：纯浏览器网页无法直接读取系统进程/窗口信息，本项目已采用 Electron 桌面架构。

## 环境要求

- Windows 10/11
- Node.js 18+（建议 20+）
- npm 9+

## 开发运行（桌面）

在项目根目录执行：

```bash
npm install
npm run dev
```

会同时启动：

- Vite 开发服务器：`http://localhost:8080`
- Electron 桌面窗口

## 仅前端预览（无系统监控）

```bash
npm run dev:renderer
```

## 打包 EXE

```bash
npm run build:desktop
```

输出目录：

```text
release/
```

安装包示例：

`release/MindfulDesktop-0.1.0-setup.exe`

## 浏览器插件（域名级别识别）

插件目录：

`browser-extension/`

安装步骤（Chrome/Edge）：

1. 打开 `chrome://extensions` 或 `edge://extensions`
2. 打开“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择 `browser-extension` 目录

工作规则：

- 只识别 URL 中的域名（例如 `https://www.bilibili.com/xxxx` 统一为 `bilibili.com`）
- 忽略路径、参数、锚点
- 同域名多个标签页算同一个事项（覆盖关系，不重复累计）

桌面端监听地址：

`http://127.0.0.1:17321/browser-bridge`

## 常用命令

```bash
npm run lint
npm run test
npm run build
```

## 若安装依赖时遇到证书问题

某些网络环境下 `npm install` 下载 Electron 依赖会失败，可临时使用：

```powershell
$env:NODE_TLS_REJECT_UNAUTHORIZED='0'
npm install
```

完成后建议关闭该环境变量，避免长期关闭 TLS 校验。
