# KewuToolbox（可无的工具箱）

本地效率工具，核心目标是“真实记录窗口行为 + 专注管理 + 任务管理 + 本地数据分析”。

技术栈：
- 前端：React + Vite + TypeScript + Tailwind + shadcn/ui
- 桌面端：Electron
- 系统窗口采集：`active-win`
- 电源事件采集：Electron `powerMonitor`
- 浏览器标签识别增强：`browser-extension`（Chrome/Edge 扩展，按域名或白名单 URL 识别）

---

## 目录

- [一、软件功能介绍](#一软件功能介绍)
- [二、软件使用说明](#二软件使用说明)
- [三、软件编译配置说明](#三软件编译配置说明)

---

## 一、软件功能介绍

- [软件功能介绍](./docs/软件功能介绍.md)

---

## 二、软件使用说明

以下按“第一次使用”路径说明。

### 1. 启动方式

#### 1.1 直接使用（推荐）

1. 打开发布页：<https://github.com/kewuuuu/KewuToolbox/releases>
2. 下载 `release` 中的 `.exe`（例如 `KewuToolbox-xxx-portable.exe` 或安装包）。
3. 双击 `.exe` 直接启动软件。

说明：
- 直接使用不需要安装 Node.js。
- 适合普通用户。

#### 1.2 开发模式

1. 准备环境：Node.js 18+（建议 Node 20 LTS）。
2. 在项目根目录安装依赖：

```bash
npm install
```

3. 启动开发模式：

```bash
npm run dev
```

说明：
- 会同时启动 Vite 前端和 Electron 桌面壳。
- 若提示 `concurrently` 找不到，通常是依赖未安装完整，重新执行 `npm install`。

### 2. 首次启动建议配置

进入“设置 > 通用配置”，建议先做：

1. 设置“记录阈值（秒）”（默认 60 秒）。
2. 选择亮色/暗色主题。
3. 决定是否开启“开机自启动”。
4. 设置“倒计时完成后处理方式”。
5. 检查“数据文件路径”是否符合你的存放习惯。
6. 按需配置 URL 白名单和进程黑名单。

### 3. 安装浏览器扩展（建议）

1. 打开 `chrome://extensions` 或 `edge://extensions`。
2. 开启“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择项目中的 `browser-extension` 文件夹。

安装后，浏览器标签会被更准确识别为域名/白名单 URL 对象。

### 4. 各模块使用步骤

#### 4.1 进程管理

1. 打开“进程管理 > 当前进程”，确认实时识别结果是否正常。
2. 给常用窗口设置“分类”（学习/娱乐/社交/休息/其他）。
3. 可在“历史记录 / 当前进程”中点击行尾“屏蔽”按钮，一键将该项加入进程黑名单。
4. 在“标签管理”创建标签，并给窗口分配标签。
5. 在“历史记录”查看累计结果，可按列排序与标签展开查看。
6. 需要清理历史时，使用“删除记录”模式勾选后确认删除。

#### 4.2 专注

1. 在“专注事项”创建事项（标题、默认时长、窗口组）。
2. 编辑事项时可在“已添加进程/规则”里删除已有项。
3. 支持两种添加方式：
   - 从“当前打开窗口”勾选快速添加。
   - 手动添加匹配规则（名称/类型/进程，支持通配符）。
4. 手动规则中：若类型填写 `BrowserTab`，则进程字段自动忽略，名称按网址通配匹配。
5. 未填写的匹配字段视为“匹配全部”。
6. 把事项加入队列，在“番茄钟”中检查顺序与每项时长。
7. 设置循环次数、偏离阈值和偏离模式（连续/累计）后开始专注。

#### 4.3 时钟

1. 秒表：开始、断点、结束并保存。
2. 秒表记录：重命名、删除、查看详情与复制导出。
3. 倒计时：新建任务、开始/暂停、到点提醒、按设置保留或删除。

#### 4.4 计算器

1. 进入“计算器 > 算数计算机”。
2. 输入表达式后实时返回结果，或返回 `NaN` / “除数不能为零” / “式子不合法”。
3. 支持 `+ - * / % ^`、括号、`log/ln/lg/sqrt/abs`、常量 `pi/e`。
4. 输入一元方程（含 `=`，未知数为 `x`）时会自动求解并返回解集或无解。

#### 4.5 待办与归档

1. 在“待办列表”新建任务（一次性/重复、可选定时提醒）。
2. 点击卡片进入详情，填写心得（自动保存）。
3. 勾选完成后进入归档列表，在归档详情查看历史快照。

#### 4.6 数据统计

1. 进入“数据统计”页面。
2. 切换显示维度（性质/窗口）和统计日期。
3. 查看扇形图、柱状图、时间线和热力图。

---

## 三、软件编译配置说明

### 1. 项目根目录

本仓库根目录（`package.json` 所在目录）即构建根目录，例如：

`D:\engine\GitHub\KewuToolbox`

### 2. 常用命令

```bash
# 开发
npm run dev

# 仅构建前端 dist
npm run build

# 打安装包（NSIS）
npm run build:desktop

# 打便携版单文件 EXE
npm run build:portable

# 打 macOS 便携版 ZIP（需在 macOS 上执行）
npm run build:mac:portable

# 一键交付构建（按当前系统打包便携版 + 浏览器扩展）
npm run build:deliver
```

### 3. electron-builder 关键配置（package.json）

- `build.appId`: `com.kewu.toolbox`
- `build.productName`: `KewuToolbox`
- `build.directories.output`: `release`
- `build.win.icon`: `public/favicon.ico`
- `build.win.target`: `nsis`
- `build.portable.artifactName`: `KewuToolbox-${version}-portable.${ext}`
- `build.mac.artifactName`: `KewuToolbox-${version}-mac-portable.${ext}`

### 4. 构建产物说明

#### 安装包构建

```bash
npm run build:desktop
```

输出示例：
- `release/KewuToolbox-<version>-setup.exe`

#### 便携版构建

```bash
npm run build:portable
```

输出示例：
- `release/KewuToolbox-<version>-portable.exe`

#### macOS 便携版构建

```bash
npm run build:mac:portable
```

输出示例：
- `release/KewuToolbox-<version>-mac-portable.zip`

#### 交付构建（推荐给分发）

```bash
npm run build:deliver
```

`build-deliver.ps1` 会执行：
1. 清空 `release`（避免上次残留）。
2. 构建前端 `dist`。
3. 按当前系统构建便携包：
   - Windows 主机：构建 `portable.exe`
   - macOS 主机：构建 `mac-portable.zip`
4. 复制便携包 + `browser-extension/` 到 `release/deliver/`。
5. 删除其他非交付文件。

最终只保留：
- `release/deliver/KewuToolbox-<version>-portable.exe`（Windows 构建时）
- `release/deliver/KewuToolbox-<version>-mac-portable.zip`（macOS 构建时）
- `release/deliver/browser-extension/`

### 5. 数据文件与路径机制

桌面版数据文件默认名：`app-state.json`。

运行策略：
- 开发环境默认在用户目录（`%APPDATA%\kewu-toolbox\app-state.json`）。
- 打包后固定使用 EXE 同级目录：`.\data\app-state.json`（不再回退到 `%APPDATA%`）。

附加文件：
- `.\data\storage-config.json`：保存你在“设置”里改过的数据文件路径。
- 打包版 Electron 运行期文件（缓存/会话/日志/崩溃转储）也会写入：
  - `.\data\electron-runtime\user-data\`
  - `.\data\electron-runtime\session-data\`
  - `.\data\electron-runtime\logs\`
  - `.\data\electron-runtime\crash-dumps\`

### 6. 浏览器扩展版本

扩展版本在 `browser-extension/manifest.json` 的 `version` 字段中维护，当前为 `0.2.0`。
