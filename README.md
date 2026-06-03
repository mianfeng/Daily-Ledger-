# Daily Ledger

一个基于 React + Vite 的本地账本工具，包含两个模块：

- 铜钱分账：记录现金库、库存成本、销售成本、毛利润和进货支出
- 日常账本：记录日常收支、每日额度和月度趋势

## 技术栈

- React 19
- TypeScript
- Vite
- Recharts
- SheetJS (`xlsx`)
- Tailwind CSS CDN

## 本地运行

前提：已安装 Node.js。

1. 安装依赖：`npm install`
2. 启动开发环境：`npm run dev`
3. 构建生产包：`npm run build`

## 数据说明

- 应用数据默认保存在浏览器 `localStorage`
- 导出功能使用 Excel 文件
- 当前仓库不依赖 Gemini 或其他后端 API
