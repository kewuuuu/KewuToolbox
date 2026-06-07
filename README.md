# KewuToolbox（可无的工具箱）

本地效率工具，核心目标是“真实记录窗口行为 + 专注管理 + 任务管理 + 本地数据分析”。

技术栈：
- 前端：React + Vite + TypeScript + Tailwind + shadcn/ui
- 桌面端：Electron
- 系统窗口采集：`active-win`
- 全局键鼠采集：`uiohook-napi`
- 电源事件采集：Electron `powerMonitor`
- 统一插件桥接：`plugin-bridge`（官方浏览器插件 + 第三方插件扩展能力）

---

## 目录

- [一、软件功能介绍](#一软件功能介绍)
- [二、软件使用说明](#二软件使用说明)
- [三、软件编译配置说明](#三软件编译配置说明)

---

## 一、软件功能介绍

- [软件功能介绍](./docs/软件功能介绍.md)
- [插件接入规范](./docs/插件接入规范.md)
- [更新记录](./docs/更新记录.md)

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
2. 设置“数据统计窗口数量 n”（默认 10），用于限制数据统计窗口模式下的图表显示数量。
3. 选择亮色/暗色主题。
4. 决定是否开启“开机自启动”。
5. 设置“倒计时完成后处理方式”。
6. 检查“数据目录路径”和“数据库”状态是否符合你的存放习惯。
7. 按需配置白名单规则和进程黑名单；已有历史记录需要按新白名单重算时，点击“按白名单归并记录”。
8. 页面中的未提交输入会在切换页面后保留，例如白名单草稿、待办创建表单、专注事项弹窗、统计页筛选项。

### 3. 安装浏览器扩展（建议）

1. 打开 `chrome://extensions` 或 `edge://extensions`。
2. 开启“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择项目中的 `browser-extension` 文件夹。

安装后，浏览器窗口会由插件对象替代上报，识别粒度更细。

### 4. 各模块使用步骤

#### 4.1 进程管理

1. 打开“进程管理 > 当前进程”，确认实时识别结果是否正常。
2. 给常用窗口设置“分类”（学习/娱乐/社交/休息/其他）。
3. 可在“历史记录 / 当前进程”中点击行尾“屏蔽”按钮，一键将该项加入进程黑名单。
4. 在“标签管理”创建标签，并给窗口分配标签。
5. 在“历史记录”查看累计结果，可按列排序与标签展开查看。
6. 短于记录阈值的切走/关闭空隙会在数据层忽略，回到同一对象后按连续时长统计。
7. 需要清理历史时，使用“删除记录”模式勾选后确认删除。

#### 4.2 专注

1. 在“专注事项”创建事项（标题、默认时长、窗口组）。
2. 编辑事项时可在“已添加进程/规则”里删除已有项。
3. 支持两种添加方式：
   - 从“当前打开窗口”勾选快速添加。
   - 手动添加匹配规则（名称/类型/进程，支持通配符）。
4. 手动规则采用统一字段匹配：名称/类型/进程已填写字段需同时命中。
5. 未填写的匹配字段视为“匹配全部”（统一匹配逻辑，不区分网址/进程规则）。
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
2. 点击卡片进入详情，填写心得（输入后立即写入数据，防止切页丢失）。
3. 勾选完成后进入归档列表，在归档详情查看历史快照。

#### 4.6 数据统计

1. 进入“数据统计”页面。
2. 使用顶部共享时间段选择器选择起止日期，支持手动输入、双日历选择，以及“今日 / 历史所有 / 最近一周 / 最近一月”快捷项。
3. 在“焦点数据”子页面查看扇形图、柱状图、小时活动、趋势图、时间线和热力图。
4. 每个支持切换的焦点图表右上角都可以独立选择“按性质”或“按窗口”显示。
5. 在“键鼠数据”子页面查看按键、点击、滚动、移动统计；键鼠数据按窗口对象归因。
6. 软件只保存键鼠聚合数据，不保存输入内容、具体按键文本、鼠标坐标或点击位置。
7. 键鼠记录会遵循“记录阈值”：窗口未达到阈值前只在内存中缓存，达到阈值才写入；未达到阈值就关闭的临时窗口不会写入统计。
8. 如果焦点落在管理员权限运行的程序上，普通权限运行的 KewuToolbox 可能无法捕获对应键鼠事件。

#### 4.7 软件更新

1. 进入“设置 > 更新”页面。
2. 点击“GitHub 仓库首页”可打开项目主页。
3. 点击“检查更新”会读取 GitHub Releases 最新正式版本。
4. 如果发现新版本且 Release 中包含便携版 exe 和对应 `.sha256`，可以点击“开始更新”。
5. 开始更新后，主程序会先下载新版 exe 和 `.sha256` 并显示进度；校验通过后再生成/调用 `KewuToolboxUpdater.ps1` 与 `KewuToolboxUpdater.cmd`，由更新脚本关闭主程序、替换 exe 并重启。

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

# 一键交付构建（按当前系统打包便携版 + 插件压缩包 + sha256）
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
   - Windows 交付构建会跳过 `winCodeSign` 资源编辑步骤，避免普通权限环境下解压符号链接失败。
4. 复制便携包 + 插件目录到 `release/deliver/`，并生成 `browser-extension.zip` 与 `vscode-extension.zip`。
5. 为所有交付文件生成 `.sha256`。
6. 删除其他非交付文件。

最终只保留：
- `release/deliver/KewuToolbox-<version>-portable.exe`（Windows 构建时）
- `release/deliver/KewuToolbox-<version>-portable.exe.sha256`（Windows 构建时）
- `release/deliver/KewuToolbox-<version>-mac-portable.zip`（macOS 构建时）
- `release/deliver/KewuToolbox-<version>-mac-portable.zip.sha256`（macOS 构建时）
- `release/deliver/browser-extension/`
- `release/deliver/browser-extension.zip`
- `release/deliver/browser-extension.zip.sha256`
- `release/deliver/vscode-extension/`
- `release/deliver/vscode-extension.zip`
- `release/deliver/vscode-extension.zip.sha256`

### 5. GitHub Actions 自动发布

仓库包含 `.github/workflows/release.yml`：
- 推送到 `main` 或手动触发 workflow 后，会在 Windows runner 上执行 `npm run build:deliver`。
- 工作流读取 `package.json` 的 `version`，生成 tag：`v<version>`。
- 工作流会优先读取 `docs/release-notes/v<version>.md` 作为 GitHub Release 说明，例如 `docs/release-notes/v1.0.5.md`。
- 如果对应版本说明文件不存在，会继续尝试读取 `docs/release-notes/<version>.md` 或根目录 `RELEASE_NOTES.md`。
- 如果说明文件中没有 `Full Changelog:`，工作流会自动追加上一版本到当前版本的对比链接。
- 如果同版本 Release 已存在，会移动同名 tag、更新 Release 标题和说明、删除旧资产并上传新资产。
- 如果同版本 Release 不存在，会创建新的 GitHub Release。
- 自动更新至少需要 Release 中包含：
  - `KewuToolbox-<version>-portable.exe`
  - `KewuToolbox-<version>-portable.exe.sha256`

说明：同版本覆盖发布便于测试，但正式发布更建议每次递增版本号，否则用户和下载缓存可能难以区分构建批次。

### 6. 数据文件与路径机制

桌面版主数据文件默认名：`kewu-toolbox.sqlite`。

运行策略：
- 开发环境默认在用户目录下的 `state-data\kewu-toolbox.sqlite`。
- 打包后固定使用 EXE 同级目录：`.\data\state-data\kewu-toolbox.sqlite`（不再回退到 `%APPDATA%`）。
- 旧版 `app-state.json` 或分片 JSON 会作为迁移来源保留，首次启动新版时会自动写入 SQLite；也可在“设置 > 数据库”手动执行迁移。

附加文件：
- `.\data\storage-config.json`：保存你在“设置”里改过的数据目录路径。
- 打包版 Electron 运行期文件（缓存/会话/日志/崩溃转储）也会写入：
  - `.\data\electron-runtime\user-data\`
  - `.\data\electron-runtime\session-data\`
  - `.\data\electron-runtime\logs\`
  - `.\data\electron-runtime\crash-dumps\`

### 7. 浏览器扩展版本

扩展版本在 `browser-extension/manifest.json` 和 `vscode-extension/package.json` 的 `version` 字段中维护，当前为 `1.0.4`。插件版本不跟随主程序版本自动同步，兼容范围分别维护在 `browser-extension/COMPATIBILITY.md` 和 `vscode-extension/COMPATIBILITY.md`。
