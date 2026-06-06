# Daily Ledger

一个基于 React + Vite 的账本工具，包含两个模块：

- 铜钱分账：记录现金库、库存成本、销售成本、毛利润和进货支出
- 日常账本：记录日常收支、每日额度和月度趋势

## 技术栈

- React 19
- TypeScript
- Vite
- Node.js built-in HTTP server
- Python stdlib deployment runner for constrained VPS hosts
- File-backed JSON storage
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

## VPS 轻量部署（推荐给 1G 内存 VPS）

前提：

- 本地已安装 Node.js，用于构建前端和生成密码 hash
- VPS 已安装 Python 3
- 域名 A 记录已解析到 VPS IP，或先通过 Tailscale IP 内网访问

不要在 1G 内存 VPS 上运行 `npm run build`、`npm install` 或 `docker compose up --build`。请在本地构建，再上传 `dist/` 和 `server/daily_ledger_server.py`。

部署步骤：

1. 本地构建：
   ```bash
   npm run build
   ```

2. 本地生成密码 hash：
   ```bash
   npm run hash-password -- "your-password"
   ```

3. 上传这些内容到 VPS，例如 `/opt/daily-ledger/`：
   ```text
   dist/
   server/daily_ledger_server.py
   .env
   ```

4. VPS 上创建数据目录：
   ```bash
   mkdir -p /opt/daily-ledger/data /opt/daily-ledger/backups
   ```

5. 编辑 `/opt/daily-ledger/.env`：
   ```env
   HOST=100.104.222.23
   PORT=3000
   ADMIN_USERNAME=admin
   ADMIN_PASSWORD_HASH=scrypt:...
   SESSION_TTL_DAYS=30
   COOKIE_SECURE=false
   ```

   如果通过 HTTPS 域名访问，`COOKIE_SECURE=true`。如果先走 Tailscale HTTP 内网地址，`COOKIE_SECURE=false`。

6. 创建 systemd 服务 `/etc/systemd/system/daily-ledger.service`：
   ```ini
   [Unit]
   Description=Daily Ledger
   After=network.target

   [Service]
   Type=simple
   WorkingDirectory=/opt/daily-ledger
   EnvironmentFile=/opt/daily-ledger/.env
   ExecStart=/usr/bin/python3 /opt/daily-ledger/server/daily_ledger_server.py
   Restart=on-failure
   RestartSec=5

   [Install]
   WantedBy=multi-user.target
   ```

7. 启动：
   ```bash
   systemctl daemon-reload
   systemctl enable --now daily-ledger
   ```

## Docker 部署（较大 VPS 可用）

仓库仍包含 `Dockerfile`、`docker-compose.yml` 和 `Caddyfile`。这条路线会在服务器上构建前端，不建议在 1G 内存 VPS 上使用。

## 数据和备份

- 主数据：`./data/ledger.json`
- 登录会话：`./data/sessions.json`
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
