# KewuToolbox

仅 Windows 使用的本地效率工具，包含：

- 专注（番茄钟 + 专注事项）
- 进程管理（历史记录 / 当前进程 / 标签管理）
- 数据统计图表
- 代办与归档

## 技术栈

- 前端：React + Vite + TypeScript + shadcn/ui
- 桌面端：Electron
- 系统监控：active-win + powerMonitor
- 浏览器域名桥接：`browser-extension/`（Chrome / Edge）

## 开发运行

```bash
npm install
npm run dev
```

会同时启动 Vite 与 Electron。

## 打包

### 1) 安装包（推荐普通用户）

```bash
npm run build:desktop
```

输出示例：

- `release/KewuToolbox-0.1.0-setup.exe`

### 2) 便携单文件 EXE

```bash
npm run build:portable
```

输出示例：

- `release/KewuToolbox-0.1.0-portable.exe`

## 数据文件位置（关键）

打包后的程序会优先将数据写入 **EXE 同目录**：

- `.\data\app-state.json`

首次运行若不存在会自动创建。

如果 EXE 所在目录无写权限（例如放在受限系统目录），会自动回退到：

- `%APPDATA%/kewu-toolbox/app-state.json`

## 常用命令

```bash
npm run lint
npm run test
npm run build
```
