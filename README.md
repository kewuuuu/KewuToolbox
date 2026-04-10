# KewuToolbox

一个仅 Windows 使用的本地效率工具，包含：

- 番茄钟与专注队列
- 进程管理（窗口/进程/焦点）
- 系统事件（开关机、锁屏、恢复）
- 待办与归档

## 技术架构

- 前端：`React + Vite + TypeScript + shadcn/ui`
- 桌面端：`Electron`
- 系统监控：`active-win` + `powerMonitor`
- 浏览器域名桥接：`browser-extension`（Chrome/Edge 扩展）

## 开发运行

```bash
npm install
npm run dev
```

会同时启动：

- `http://localhost:8080`（Vite）
- Electron 桌面窗口

## 仅前端预览（无系统监控能力）

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

`release/KewuToolbox-0.1.0-setup.exe`

## 浏览器扩展（域名级识别）

扩展目录：

`browser-extension/`

安装方式（Chrome/Edge）：

1. 打开 `chrome://extensions` 或 `edge://extensions`
2. 打开“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择 `browser-extension` 文件夹

规则：

- 只识别 URL 域名，忽略路径、参数、锚点
- 同域名多个标签页按同一事项统计（覆盖关系，不重复累计）

## 常用命令

```bash
npm run lint
npm run test
npm run build
```
