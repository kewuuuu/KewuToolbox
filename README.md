# 窗口专注助手（WPF / .NET 8）

一个 Windows 本地效率工具，包含番茄钟专注、窗口监测、统计分析和待办管理。

## 功能概览
- 分页式主界面：每页聚焦一个功能，顶部可快速切页。
- 番茄钟专注：
  - 可手动输入专注/休息时长和循环次数。
  - 支持允许专注窗口选择、偏离阈值提醒（连续/累计）。
  - 支持专注事项、专注队列、模板保存/加载。
- 窗口与焦点监测：
  - 记录窗口开启时长、焦点时长。
  - 支持桌面识别与浏览器前台标签页识别。
- 电源/会话事件：
  - 记录系统启动、关机、挂起恢复、锁屏解锁等事件。
- 数据统计：
  - 支持进程性质映射（学习/娱乐/社交/休息/其他）。
  - 扇形图、时间轴、热力图、柱状图。
- 待办事项：
  - 一次性/重复任务（每日、每周、每月、自定义）。
  - 定时提醒、归档、心得自动保存。

## 环境要求
- Windows 10/11
- .NET 8 SDK

## 本地运行
在项目目录执行：

```powershell
dotnet restore
dotnet run
```

## 打包发布（EXE）
在项目目录执行：

```powershell
.\publish.ps1
```

默认输出目录：
`bin\Release\net8.0-windows\win-x64\publish`

如果目标 EXE 被占用，脚本会自动回退到带时间戳的新目录。

## 数据文件位置
- 调试运行：`bin\Debug\net8.0-windows\data\app.db`
- 发布运行：`publish` 目录下的 `data\app.db`

## 常见问题
### 双击 `publish.ps1` 只用记事本打开，没有执行
请在 PowerShell 中进入项目目录后运行：

```powershell
.\publish.ps1
```

如果提示执行策略受限，可临时执行：

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\publish.ps1
```
