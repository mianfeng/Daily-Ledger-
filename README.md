# Daily Ledger

一个基于 React + Vite 的静态账本工具，包含两个模块：

- 铜钱分账：记录现金库、库存成本、销售成本、毛利润和进货支出
- 日常账本：记录日常收支、每日额度和月度趋势

## 技术栈

- React 19
- TypeScript
- Vite
- Recharts
- SheetJS (`xlsx`)
- Tailwind CSS CDN

## 数据存储

当前正式版本面向 GitHub 静态部署，不需要 VPS、后端 API、数据库或登录服务。

数据保存在当前浏览器的 `localStorage`：

- 铜钱分账：`coinShopData_v5`
- 日常账本：`dailyBookData_v5`

换手机、换电脑或更换域名时，请先在旧设备点击「导出整站」，再在新设备点击「恢复整站」导入 JSON 备份。

## 本地运行

前提：已安装 Node.js。

```bash
npm install
npm run dev
```

开发服务器默认监听 `0.0.0.0:3000`。

## 构建

```bash
npm run build
```

构建结果输出到 `dist/`。

## GitHub 静态部署

如果使用 GitHub Pages、Cloudflare Pages、Vercel 或 Netlify 这类静态托管：

1. 构建命令：`npm run build`
2. 输出目录：`dist`
3. 不需要设置服务器环境变量
4. 不需要运行 `npm run server`

如果 GitHub Pages 部署在仓库子路径而不是自定义域名根路径，可能需要在 `vite.config.ts` 中设置 `base`。自定义域名根路径部署时保持默认即可。

## 备份和迁移

页面顶部提供整站 JSON 备份：

- 「导出整站」会导出铜钱分账和日常账本的完整数据
- 「恢复整站」会用备份覆盖当前浏览器的数据

组件内部仍保留 Excel 导入/导出，用于单独备份铜钱分账或日常账本。

## 不再使用 VPS 后端

项目曾短暂支持 VPS API 存储。当前正式 GitHub 静态部署版本已经取消运行时后端依赖：

- 没有 `/api/auth/*`
- 没有 `/api/ledger`
- 没有 VPS systemd 服务
- 没有服务器端自动同步

多设备自动同步需要另接 Supabase、Firebase、Cloudflare Workers/D1 等外部服务；静态 GitHub 部署本身不提供持久后端。
