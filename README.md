# Daily Ledger

一个基于 React + Vite 的账本工具，包含两个模块：

- 铜钱分账：记录现金库、库存成本、销售成本、毛利润和进货支出
- 日常账本：记录日常收支、每日额度和月度趋势

## 技术栈

- React 19
- TypeScript
- Vite
- Node.js + Express
- SQLite (`better-sqlite3`)
- Recharts
- SheetJS (`xlsx`)
- Tailwind CSS CDN

## 本地运行

前提：已安装 Node.js。

1. 安装依赖：
   ```bash
   npm install
   ```

2. 生成管理员密码 hash：
   ```bash
   npm run hash-password -- "your-password"
   ```

3. 创建本地 `.env`：
   ```bash
   cp .env.example .env
   ```
   将 `ADMIN_PASSWORD_HASH` 改成上一步生成的值。

4. 启动后端 API：
   ```bash
   npm run server
   ```

5. 另开一个终端启动前端：
   ```bash
   npm run dev
   ```

Vite 会把 `/api` 代理到本地后端。开发环境后端默认端口是 `3001`，生产环境默认端口是 `3000`。

## VPS 部署

前提：

- VPS 已安装 Docker 和 Docker Compose
- 域名 A 记录已解析到 VPS IP
- 80 / 443 端口已开放

部署步骤：

1. 上传项目到 VPS。

2. 生成密码 hash：
   ```bash
   npm install
   npm run hash-password -- "your-password"
   ```

3. 创建 `.env`：
   ```bash
   cp .env.example .env
   ```

4. 编辑 `.env`：
   ```env
   APP_DOMAIN=ledger.example.com
   ADMIN_USERNAME=admin
   ADMIN_PASSWORD_HASH=scrypt:...
   SESSION_TTL_DAYS=30
   COOKIE_SECURE=true
   ```

5. 启动：
   ```bash
   docker compose up -d --build
   ```

Caddy 会自动申请 HTTPS 证书，并把域名流量转发到应用容器。

## 数据和备份

- SQLite 主库：`./data/ledger.sqlite`
- 每日 JSON 备份：`./backups/YYYY-MM-DD.json`
- 自动备份保留最近 30 天
- 前端仍支持手动导出整站 JSON 备份

`data/`、`backups/` 和 `.env` 已加入 `.gitignore`，不要提交数据库或密钥。

## 从手机本地数据迁移

旧版本数据保存在浏览器 `localStorage`。新版本登录后：

1. 如果服务器还没有账本数据
2. 且当前浏览器检测到旧本地数据
3. 页面会提示是否导入到 VPS

确认后会把当前浏览器里的铜钱分账和日常账本一起上传到服务器。服务器已有数据时不会自动用本地数据覆盖。

## 同步规则

- 编辑后自动保存到 VPS
- 每次保存都带服务器 `revision`
- 如果另一台设备已经更新过数据，旧页面保存会被拒绝
- 冲突时页面会提示刷新，不会静默覆盖服务器新数据
- 第一版要求联网编辑，不实现完整离线同步队列
