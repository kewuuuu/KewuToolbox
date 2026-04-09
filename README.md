# Mindful Desktop

一个基于 `React + Vite + TypeScript` 的桌面效率工具前端，包含番茄钟、窗口分类统计、待办事项与归档管理页面。

## 环境要求

- Node.js 18+（建议 20+）
- npm 9+

## 本地运行

在项目根目录执行：

```bash
npm install
npm run dev
```

启动后访问终端输出的本地地址（默认通常是 `http://localhost:5173`）。

## 常用命令

```bash
# 开发模式
npm run dev

# 生产构建
npm run build

# 本地预览构建产物
npm run preview

# 运行测试
npm run test

# 监听测试
npm run test:watch

# 代码检查
npm run lint
```

## 说明

- 应用数据目前保存在浏览器 `localStorage`（键名：`efficiency-app-state`）。
- 如需清空本地数据，可在浏览器开发者工具中删除该键后刷新页面。
