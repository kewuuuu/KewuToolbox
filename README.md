# Mindful Desktop

一个仅 Windows 使用的本地效率工具，包含：

- 番茄钟与专注队列
- 焦点窗口统计
- 打开窗口时长统计
- 开关机/锁屏/恢复事件记录
- 待办与归档

## 架构说明

- 前端：`React + Vite + TypeScript + shadcn/ui`
- 桌面壳：`Electron`
- 真实数据采集：`active-win`（焦点窗口 + 打开窗口列表）+ Electron `powerMonitor`
- 本地数据存储：`%AppData%/<应用目录>/app-state.json`

说明：纯浏览器环境无法直接读取系统进程/窗口信息，所以本项目已改为 Electron 桌面架构。

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

- Vite 开发服务器（`http://localhost:8080`）
- Electron 桌面窗口

## 仅前端预览（无系统监控能力）

```bash
npm run dev:renderer
```

这时页面能打开，但不会有真实系统窗口/进程采集。

## 打包 EXE

```bash
npm run build:desktop
```

产物输出目录：

```text
release/
```

## 常用命令

```bash
npm run lint
npm run test
npm run build
```

## 证书下载问题（如果你遇到 Electron 下载失败）

某些网络环境会在 `npm install` 下载 Electron 二进制时出现证书错误。可临时使用：

```powershell
$env:NODE_TLS_REJECT_UNAUTHORIZED='0'
npm install
```

完成安装后建议关闭该环境变量，避免长期关闭 TLS 校验。
