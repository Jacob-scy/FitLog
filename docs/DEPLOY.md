# FitLog 生产部署文档 �?Ubuntu 24.04 从零开始与运维指南

> **适用系统**：Ubuntu Server 24.04 LTS (x86_64)  
> **最后更�?*�?026-09-05（包�?Cloudflare Tunnel 多域名复用、PWA/Service Worker 媒体缓存治理与真实移动端自愈配置�? 
> **预计耗时**：首次部署约 30�?5 分钟；日常增量更新约 2�? 分钟  
> **访问方式**：Cloudflare Tunnel 公网安全访问 / 局域网反向代理  
> **生产站点**：[https://fitlog.jacobscy.xyz](https://fitlog.jacobscy.xyz)  
> **源码仓库**：[https://github.com/Jacob-scy/FitLog.git](https://github.com/Jacob-scy/FitLog.git)

---

## 目录

- [1. 项目简介](#1-项目简�?
- [2. 生产环境架构与拓扑](#2-生产环境架构与拓�?
- [3. 服务器环境要求与版本基线](#3-服务器环境要求与版本基线)
- [4. 生产目录结构规范与权限模型](#4-生产目录结构规范与权限模�?
- [5. Git 仓库与版本发布基线](#5-git-仓库与版本发布基�?
- [6. Linux 系统用户配置](#6-linux-系统用户配置)
- [7. Node.js 20 运行时安装](#7-nodejs-20-运行时安�?
- [8. MySQL 8.0 数据库配置](#8-mysql-80-数据库配�?
- [9. Redis 服务与多租户隔离](#9-redis-服务与多租户隔离)
- [10. 生产环境变量配置](#10-生产环境变量配置)
- [11. Prisma 迁移与数据表结构发布](#11-prisma-迁移与数据表结构发布)
- [12. 官方动作库与物理媒体资源初始化](#12-官方动作库与物理媒体资源初始�?
- [13. 前端生产构建与发布](#13-前端生产构建与发�?
- [14. systemd 服务单元管理](#14-systemd-服务单元管理)
- [15. Nginx 高性能反向代理配置](#15-nginx-高性能反向代理配置)
- [16. Cloudflare Tunnel 公网暴露与多服务复用](#16-cloudflare-tunnel-公网暴露与多服务复用)
- [17. HTTPS 与边缘安全策略](#17-https-与边缘安全策�?
- [18. 首次完整部署流程 (Step-by-Step)](#18-首次完整部署流程-step-by-step)
- [19. 日常增量更新部署流程 (Update Deployment)](#19-日常增量更新部署流程-update-deployment)
- [20. 服务日常运维管理与常用命令表](#20-服务日常运维管理与常用命令表)
- [21. 实时日志审计与流式排查](#21-实时日志审计与流式排�?
- [22. 健康检查探针与接口验证](#22-健康检查探针与接口验证)
- [23. 生产备份机制与策略](#23-生产备份机制与策�?
- [24. 灾难数据恢复方案](#24-灾难数据恢复方案)
- [25. 紧急版本回滚方�?(Rollback)](#25-紧急版本回滚方�?rollback)
- [26. PWA / Service Worker 缓存策略](#26-pwa--service-worker-缓存策略)
- [27. 生产踩坑记：媒体缓存与移动端跨源治理](#27-生产踩坑记媒体缓存与移动端跨源治�?
- [28. 常见生产故障排查手册](#28-常见生产故障排查手册)
- [29. 生产安全合规与操作禁令](#29-生产安全合规与操作禁�?
- [30. 生产配置清单�?Secret Inventory](#30-生产配置清单�?secret-inventory)
- [附录 A：一键部署脚本使用说明](#附录-a一键部署脚本使用说�?
- [附录 B：上线最终验�?Checklist](#附录-b上线最终验�?checklist)

---

## 1. 项目简�?
**FitLog** 是一款专注于力量训练与健身数据追踪的高性能 Progressive Web Application (PWA)�?
- **前端架构**：React 18 + Vite 6 + TailwindCSS，集�?Workbox 构建现代化离线缓存机制，支持单手触控交互与动�?视频原生播放�?- **后端架构**：Node.js 20 + Express + Prisma ORM，遵�?RESTful 规范，支�?JWT �?Token（短�?Access + 长效 Refresh）无感续期�?- **高并发与限流**：Redis 存储短信验证码、IP/手机号频控计数器及会话缓存�?- **多媒体伺�?*：由宿主�?Nginx 直接零拷贝伺�?1300+ 官方动作演示动图，减�?Node.js 主线程压力�?
---

## 2. 生产环境架构与拓�?
FitLog 采用 **“裸机原生高性能服务 + Nginx 反代分流 + Cloudflare 边缘安全加�?+ 零公网入站端�?Tunnel�?* 的成熟架构：

```
                    ┌─────────────────────────�?                    �?    客户�?/ 真实手机     �?                    �?(PWA / Mobile Safari /  �?                    �?  Honor / Chrome �?    �?                    └────────────┬────────────�?                                 �?HTTPS (443)
                                 �?                    ┌─────────────────────────�?                    �?Cloudflare 边缘节点 CDN �?                    �?(自动 TLS / WAF / DDoS) �?                    └────────────┬────────────�?                                 �?WireGuard 加密隧道 (出站无入�?
                                 �?                    ┌─────────────────────────�?                    �?cloudflared 守护进程    �?                    �?(复用 NetDisk 宿主实例)  �?                    └────────────┬────────────�?                                 �?HTTP :80
                                 �?                    ┌─────────────────────────────────────────────────�?                    �?           宿主�?Nginx (1.24.0)                 �?                    �?           端口: 0.0.0.0:80                      �?                    ├────────────────────────┬────────────────────────�?                    �?server_name:           �?server_name:           �?                    �?fitlog.jacobscy.xyz    �?netdisk / IP           �?                    └───────────┬────────────┴────────────┬───────────�?                                �?                        �?         ┌──────────────────────┼──────────────────────�? �?         �?                     �?                     �? �?         �?(静态资�?           �?(反向代理)            �?(静态媒�?   [NetDisk]
┌──────────────────�? ┌──────────────────�? ┌──────────────────�?(:8080)
�?/opt/fitlog/     �? �?FitLog Node.js   �? �?/opt/fitlog/     �?�?client/dist/     �? �?后端 (3001 端口)  �? �?repo/data/       �?�?(SPA + sw.js)    �? �?(fitlog.service) �? �?exercises-media/ �?└──────────────────�? └─────────┬────────�? └──────────────────�?                                �?                      ┌─────────┴─────────�?                      �?                  �?            ┌──────────────────�?┌──────────────────�?            �?MySQL 8.0 数据�?�?�?Redis 7.0 缓存   �?            �?(fitlog_prod)    �?�?(DB 1 独立隔离)  �?            �?端口: 3306       �?�?端口: 6379       �?            └──────────────────�?└──────────────────�?```

---

## 3. 服务器环境要求与版本基线

当前生产服务器已真实部署并运行以下基础环境组件�?
| 组件 / 服务 | 生产实际版本 | 运行形�?| 监听端口 / 状�?| 用途说�?|
|:---|:---|:---|:---|:---|
| **操作系统** | Ubuntu 24.04 LTS (x86_64) | 物理宿主�?| - | 底层操作系统 |
| **Node.js** | `v20.20.2` | 宿主机二进制 | - | FitLog 后端与构建运行时 |
| **npm** | `10.8.2` | 宿主机二进制 | - | Node 包管理器 |
| **MySQL** | `8.0.46-0ubuntu0.24.04.3` | systemd (`mysql`) | `127.0.0.1:3306` | 关系型主数据�?|
| **Redis** | `7.0.15` | systemd (`redis`) | `127.0.0.1:6379` | 验证�?限流/会话缓存 |
| **Nginx** | `1.24.0 (Ubuntu)` | systemd (`nginx`) | `0.0.0.0:80` | 前端托管、媒体分发、API反代 |
| **cloudflared**| `2026.6.1` | systemd (`cloudflared`) | 出站隧道 | Zero Trust 安全公网穿�?|
| **FitLog 后端** | 自研 1.0.0 | systemd (`fitlog`) | `127.0.0.1:3001` | 业务核心服务 |
| **NetDisk 服务**| 1.0.0 (Spring Boot) | systemd (`netdisk`)| `127.0.0.1:8080` | 同机并存业务（严禁干扰） |
| **Open-WebUI** | 容器�?| Docker | `127.0.0.1:3000` | 宿主既有服务（因此FitLog使用3001�?|

---

## 4. 生产目录结构规范与权限模�?
整个 FitLog 生产体系严格集中�?`/opt/fitlog/` 下，遵循最小权限与职责分离原则�?
```
/opt/fitlog/
├── .cache/                     # 用户构建缓存
├── .gitconfig                  # safe.directory 声明
├── .npm/                       # npm 依赖缓存目录
├── backups/                    # 数据�?dump 与发布产物备份目�?(保留7�?
├── client/
�?  └── dist/                   # 前端静态生产资�?(Nginx root 指向此处)
�?      ├── index.html
�?      ├── sw.js               # Service Worker 激活入�?(禁止强缓�?
�?      ├── assets/             # 带哈希的 CSS/JS/图标 (长效缓存)
�?      └── debug-media.html    # 移动端底层司法取证静态诊断工�?├── media/                      # 用户上传媒体存储 (保留扩展)
├── repo/                       # Git 仓库源码主目�?�?  ├── client/                 # 前端源码
�?  ├── server/                 # 后端源码
�?  �?  ├── prisma/             # Prisma Schema �?SQL Migrations
�?  �?  ├── src/                # Express 业务代码
�?  �?  └── package.json
�?  ├── data/
�?  �?  └── exercises-media/    # 1300+ 官方动作高清动图 (Nginx alias 零拷�?
�?  └── deploy/                 # 部署脚本、Nginx �?systemd 模版
└── server/
    └── .env                    # 生产核心敏感配置文件 (权限严格 600)
```

**系统所有权与权限要�?*�?- 用户/属组：`fitlog:fitlog`（系统专用不可登录用户）�?- `/opt/fitlog/server/.env` 权限必须�?`600`，只允许 `fitlog` �?`root` 读取�?- `/opt/fitlog/client/dist` 权限�?`755`，允�?Nginx worker 读取�?
---

## 5. Git 仓库与版本发布基�?
- **远端仓库 URL**：`https://github.com/Jacob-scy/FitLog.git`
- **生产分支**：`main`
- **拉取规范**：在服务器上只允许执行快进拉取：
  ```bash
  git pull --ff-only origin main
  ```
- **工作区规�?*：服务器上的代码目录 `/opt/fitlog/repo` 严禁直接手改代码，必须保�?Working Tree 干净，所有修改必须通过 Git 提交并推送后拉取�?
---

## 6. Linux 系统用户配置

为保障服务器主机安全性，禁止使用 `root` 直接运行 Node.js 进程�?
```bash
# 1. 创建 fitlog 系统专用运行用户 (无交互式登录权限)
sudo useradd -r -s /usr/sbin/nologin -d /opt/fitlog -m fitlog

# 2. 创建核心层级目录
sudo mkdir -p /opt/fitlog/{repo,client/dist,server,media,backups}
sudo mkdir -p /var/log/fitlog

# 3. 授权 fitlog 用户主目录所有权
sudo chown -R fitlog:fitlog /opt/fitlog
sudo chown -R fitlog:fitlog /var/log/fitlog

# 4. 配置 git 目录信任 (防止多用户切换报�?fatal: detected dubious ownership)
sudo -u fitlog git config --global --add safe.directory /opt/fitlog/repo
```

---

## 7. Node.js 20 运行时安�?
FitLog 后端与构建需�?Node.js 20 LTS�?
```bash
# 1. 导入 NodeSource 官方 Node.js 20.x �?curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -

# 2. 安装 Node.js 与构建基础编译工具
sudo apt install -y nodejs build-essential

# 3. 验证版本 (必须满足 Node >= 20.10.0, npm >= 10.0.0)
node -v    # 生产输出：v20.20.2
npm -v     # 生产输出�?0.8.2
```

---

## 8. MySQL 8.0 数据库配�?
FitLog 生产数据库独立使�?`fitlog_prod`，用户为 `fitlog_user`�?
### 8.1 登录 MySQL
```bash
sudo mysql -u root
```

### 8.2 创建数据库与用户授权
```sql
-- 1. 创建 FitLog 独立生产�?(严格采用 utf8mb4 字符集与排序规则)
CREATE DATABASE IF NOT EXISTS fitlog_prod
    DEFAULT CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

-- 2. 创建 FitLog 专用本地连接用户 (密码替换为实际强密码)
CREATE USER IF NOT EXISTS 'fitlog_user'@'127.0.0.1' IDENTIFIED BY '<FITLOG_DB_PASSWORD>';

-- 3. 授予 fitlog_prod 库的全部操作权限
GRANT ALL PRIVILEGES ON fitlog_prod.* TO 'fitlog_user'@'127.0.0.1';

-- 4. 刷新特权生效
FLUSH PRIVILEGES;

-- 5. 验证授权
SHOW GRANTS FOR 'fitlog_user'@'127.0.0.1';
EXIT;
```

### 8.3 数据库连接连通性验�?```bash
mysql -u fitlog_user -h 127.0.0.1 -p'<FITLOG_DB_PASSWORD>' -e "SELECT DATABASE(), VERSION();"
# 期望输出�?# +---------------+-------------------------+
# | DATABASE()    | VERSION()               |
# +---------------+-------------------------+
# | NULL          | 8.0.46-0ubuntu0.24.04.3 |
# +---------------+-------------------------+
```

---

## 9. Redis 服务与多租户隔离

同机运行多个业务时，必须实施严格�?**Redis 逻辑分库隔离**，严禁使用全局清库命令�?
- **NetDisk 业务**：使�?`DB 0`
- **FitLog 业务**�?*专享 `DB 1`**

### 9.1 Redis 基础验证
```bash
# 1. 验证基础连通�?redis-cli -a '<REDIS_PASSWORD>' ping
# 期望返回：PONG

# 2. 检�?FitLog 专属 DB 1 连通�?redis-cli -a '<REDIS_PASSWORD>' -n 1 ping
# 期望返回：PONG

# 3. 检�?DB 1 内部 Key (包含验证码与限流计数�?
redis-cli -a '<REDIS_PASSWORD>' -n 1 DBSIZE
```

> [!CAUTION]
> **生产操作红线**：绝对禁止在服务器上执行 `FLUSHALL`！若需清理 FitLog 缓存，仅允许进入 DB 1 执行 `redis-cli -n 1 FLUSHDB`�?
---

## 10. 生产环境变量配置

FitLog 生产环境变量存放在独立保密文件：`/opt/fitlog/server/.env`�?
### 10.1 生产配置文件模版

```bash
sudo tee /opt/fitlog/server/.env << 'EOF'
# ==========================================
# FitLog Production Environment Configuration
# ==========================================
NODE_ENV=production
PORT=3001
CORS_ORIGIN=https://fitlog.jacobscy.xyz

# --- 数据库连接池 (宿主�?MySQL) ---
DATABASE_URL="mysql://fitlog_user:<FITLOG_DB_PASSWORD>@127.0.0.1:3306/fitlog_prod?connection_limit=15&pool_timeout=10"

# --- 缓存与频�?(宿主�?Redis DB 1) ---
REDIS_URL="redis://:<REDIS_PASSWORD>@127.0.0.1:6379/1"
VERIFICATION_STORE=redis
RATE_LIMITER=redis

# --- 短信服务提供�?(生产主入口为手机�?密码，暂�?mock 免除短信资费) ---
SMS_PROVIDER=mock

# --- JWT 鉴权密钥 (使用 openssl rand -hex 32 生成) ---
JWT_ACCESS_SECRET="<FITLOG_JWT_ACCESS_SECRET>"
JWT_ACCESS_EXPIRES_IN="15m"
JWT_REFRESH_SECRET="<FITLOG_JWT_REFRESH_SECRET>"
JWT_REFRESH_EXPIRES_IN="7d"
EOF
```

### 10.2 生成高强�?JWT 密钥方法
```bash
# 生成 256 位强随机密钥
openssl rand -hex 32
```

### 10.3 设置最严文件权�?```bash
sudo chown fitlog:fitlog /opt/fitlog/server/.env
sudo chmod 600 /opt/fitlog/server/.env
```

---

## 11. Prisma 迁移与数据表结构发布

在后端源码目录中执行结构同步�?*生产环境严禁使用 `prisma migrate dev` �?`prisma db push`（防止丢数据�?*�?
```bash
cd /opt/fitlog/repo/server

# 1. 安装后端生产依赖
sudo -u fitlog npm ci --omit=dev

# 2. 生成 Prisma Client 客户端代�?sudo -u fitlog npx prisma generate

# 3. 部署生产数据库迁�?(幂等执行未应用的 SQL)
sudo -u fitlog npx prisma migrate deploy

# 4. 验证迁移状�?(应提示：Database schema is up to date!)
sudo -u fitlog npx prisma migrate status
```

---

## 12. 官方动作库与物理媒体资源初始�?
FitLog 附带 1300+ 完整体能动作数据库与对应的高清动�?视频�?
```bash
cd /opt/fitlog/repo/server

# 1. 导入官方动作基础数据 (幂等写入，支持覆盖更�?
sudo -u fitlog node prisma/seed-exercises.js

# 2. 检查物理动图文件存放位�?(必须存在且非�?
ls -lh /opt/fitlog/repo/data/exercises-media/ | head -n 10
# 确认首条动作动图存在且大�?50KB�?ls -lh /opt/fitlog/repo/data/exercises-media/2gPfomN.gif
```

---

## 13. 前端生产构建与发�?
前端必须通过 Vite 编译生成生产静态资源包并生成最新的 Service Worker�?
```bash
cd /opt/fitlog/repo/client

# 1. 安装前端构建依赖
sudo -u fitlog npm ci

# 2. 执行生产级打�?(编译 PWA Service Worker 及静�?chunk)
sudo -u fitlog npm run build

# 3. 将产物原子同步到 Nginx 静态服务目�?sudo rm -rf /opt/fitlog/client/dist/*
sudo cp -r dist/* /opt/fitlog/client/dist/

# 4. 保证权限正确
sudo chown -R fitlog:fitlog /opt/fitlog/client/dist
sudo chmod -R 755 /opt/fitlog/client/dist
```

---

## 14. systemd 服务单元管理

通过 systemd 保证 Node.js 后端在崩溃、OOM 或服务器重启时自动恢复�?
### 14.1 部署 `/etc/systemd/system/fitlog.service`

```ini
[Unit]
Description=FitLog Training Tracking Backend Service
After=network.target mysql.service redis.service
Wants=mysql.service redis.service

[Service]
Type=simple
User=fitlog
Group=fitlog
WorkingDirectory=/opt/fitlog/repo/server
EnvironmentFile=/opt/fitlog/server/.env

# 使用宿主�?Node.js 启动主程�?ExecStart=/usr/bin/node src/index.js

# 异常崩溃 5 秒自动重�?Restart=always
RestartSec=5

# 文件系统加固与白名单写入路径
ProtectSystem=full
ReadWritePaths=/opt/fitlog /var/log/fitlog

# 句柄上限优化
LimitNOFILE=65536
StandardOutput=journal
StandardError=journal
SyslogIdentifier=fitlog

[Install]
WantedBy=multi-user.target
```

### 14.2 启用并启动服�?```bash
sudo systemctl daemon-reload
sudo systemctl enable fitlog
sudo systemctl restart fitlog
sudo systemctl is-active fitlog    # 必须输出：active
```

---

## 15. Nginx 高性能反向代理配置

FitLog 站点配置位于 `/etc/nginx/sites-available/fitlog`，通过软链接启用�?
### 15.1 完整 Nginx 配置文件

```nginx
upstream fitlog_backend {
    server 127.0.0.1:3001;
    keepalive 32;
}

server {
    listen 80;
    server_name fitlog.jacobscy.xyz;

    client_max_body_size 20M;

    # === 安全响应�?===
    server_tokens off;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # === Gzip 压缩优化 ===
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_comp_level 6;
    gzip_types
        text/plain
        text/css
        text/xml
        text/javascript
        application/json
        application/javascript
        application/x-javascript
        application/xml
        application/xml+rss
        image/svg+xml;

    # ==================== 前端静态资�?(Vite SPA 构建产物) ====================
    root /opt/fitlog/client/dist;
    index index.html;

    # 1. 前端 SPA 路由回退 �?保证 HTML 入口不被浏览器强缓存
    location / {
        try_files $uri $uri/ /index.html;
        add_header Cache-Control "no-cache, no-store, must-revalidate";
    }

    # 2. PWA Service Worker 必须绝对禁止强缓存，保证新版本秒级激�?    location ~* (?:sw\.js|registerSW\.js)$ {
        add_header Cache-Control "no-cache, no-store, must-revalidate";
        add_header Pragma "no-cache";
        expires 0;
    }

    # 3. 前端哈希静态资源长效缓�?(JS / CSS / 图标)
    location ~* \.(?:css|js|woff2?|svg|ico)$ {
        expires 1y;
        add_header Cache-Control "public, max-age=31536000, immutable";
        access_log off;
    }

    # ==================== 后端 API 反向代理 ====================
    location /api/ {
        proxy_pass http://fitlog_backend;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Request-Id $http_x_request_id;
        proxy_set_header Connection "";

        proxy_connect_timeout 5s;
        proxy_read_timeout 60s;
        proxy_send_timeout 60s;
    }

    # ==================== 媒体动图静态零拷贝与跨源共�?(CORP) ====================
    location /media/exercises-dataset/ {
        alias /opt/fitlog/repo/data/exercises-media/;
        expires 30d;
        add_header Cache-Control "public, max-age=2592000, immutable";
        add_header Access-Control-Allow-Origin "*";
        add_header Cross-Origin-Resource-Policy "cross-origin";
    }

    location /media/exercises/ {
        alias /opt/fitlog/repo/data/free-exercise-db/exercises/;
        expires 30d;
        add_header Cache-Control "public, max-age=2592000, immutable";
        add_header Access-Control-Allow-Origin "*";
        add_header Cross-Origin-Resource-Policy "cross-origin";
    }

    # ==================== 系统健康探针直�?====================
    location /health {
        proxy_pass http://fitlog_backend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        access_log off;
    }

    # 禁止访问隐藏配置�?Git 文件
    location ~ /\. {
        deny all;
        return 404;
    }
}
```

### 15.2 测试并重�?Nginx
```bash
# 建立软链接启用站�?sudo ln -sf /etc/nginx/sites-available/fitlog /etc/nginx/sites-enabled/fitlog

# 测试配置正确�?sudo nginx -t
# 期望：nginx: configuration file /etc/nginx/nginx.conf test is successful

# 重载生效 (平滑无损)
sudo systemctl reload nginx
```

> [!NOTE]
> 绝对不要修改 `/etc/nginx/sites-available/netdisk`，两个站点通过各自�?`server_name` 完美共存�?
---

## 16. Cloudflare Tunnel 公网暴露与多服务复用

FitLog **不需�?* 创建额外�?Tunnel，而是完全复用已稳定运行的 NetDisk Cloudflare Tunnel 实例�?
### 16.1 架构原理
`cloudflared` 守护进程将流量转发到宿主机的 `localhost:80`（Nginx）。Nginx 根据 HTTP 请求头中�?`Host` 字段（`fitlog.jacobscy.xyz`）将流量路由�?FitLog 的前端目录或 3001 端口�?
### 16.2 �?Cloudflare Zero Trust 控制台添�?Hostname（仅需操作一次）
1. 登录 [Cloudflare Zero Trust Dashboard](https://one.dash.cloudflare.com/)�?2. 进入 **Networks** �?**Tunnels** �?找到正在运行�?Tunnel（如 `netdisk-server`）�?3. 切换�?**Published application routes**（或 **Hostname routes**）标签页�?4. 点击 **Add a public hostname**�?   - **Subdomain**：`fitlog`
   - **Domain**：`jacobscy.xyz`
   - **Type**：`HTTP`
   - **URL**：`localhost:80`
5. 点击 **Save hostname**。Cloudflare 会自动创�?DNS CNAME 记录�?
---

## 17. HTTPS 与边缘安全策�?
- **TLS 自动管理**：由 Cloudflare 边缘节点自动完成 HTTPS 握手与证书自动轮换，客户端与边缘之间完全加密�?- **防火墙零暴露**：宿主机 `ufw` 不需要开�?3001 �?8080 端口，服务器只需允许出站连接�?Cloudflare 边缘服务器即可�?
---

## 18. 首次完整部署流程 (Step-by-Step)

在全新的服务器上从零开始部�?FitLog 的完整命令清单：

```bash
# 1. 登录服务�?ssh jacob@192.168.1.62

# 2. 安装基础包与 Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs mysql-server redis-server nginx git

# 3. 创建 fitlog 系统用户
sudo useradd -r -s /usr/sbin/nologin -d /opt/fitlog -m fitlog
sudo mkdir -p /opt/fitlog/{repo,client/dist,server,media,backups}
sudo chown -R fitlog:fitlog /opt/fitlog

# 4. 克隆源码仓库
sudo -u fitlog git clone https://github.com/Jacob-scy/FitLog.git /opt/fitlog/repo
sudo -u fitlog git config --global --add safe.directory /opt/fitlog/repo

# 5. 创建 MySQL 库与用户 (执行�?8 �?SQL)
sudo mysql -u root -e "CREATE DATABASE fitlog_prod DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
sudo mysql -u root -e "CREATE USER 'fitlog_user'@'127.0.0.1' IDENTIFIED BY '<FITLOG_DB_PASSWORD>';"
sudo mysql -u root -e "GRANT ALL PRIVILEGES ON fitlog_prod.* TO 'fitlog_user'@'127.0.0.1'; FLUSH PRIVILEGES;"

# 6. 配置生产环境变量
sudo cp /opt/fitlog/repo/deploy/.env.production.example /opt/fitlog/server/.env
sudo vim /opt/fitlog/server/.env   # 填入实际密码与生成的 JWT 密钥
sudo chown fitlog:fitlog /opt/fitlog/server/.env && sudo chmod 600 /opt/fitlog/server/.env

# 7. 后端依赖与数据库迁移
cd /opt/fitlog/repo/server
sudo -u fitlog npm ci --omit=dev
sudo -u fitlog npx prisma generate
sudo -u fitlog npx prisma migrate deploy
sudo -u fitlog node prisma/seed-exercises.js

# 8. 前端构建与发�?cd /opt/fitlog/repo/client
sudo -u fitlog npm ci
sudo -u fitlog npm run build
sudo cp -r dist/* /opt/fitlog/client/dist/
sudo chown -R fitlog:fitlog /opt/fitlog/client/dist

# 9. 安装 systemd 服务
sudo cp /opt/fitlog/repo/deploy/fitlog.service /etc/systemd/system/fitlog.service
sudo systemctl daemon-reload
sudo systemctl enable fitlog && sudo systemctl start fitlog

# 10. 配置 Nginx 并重�?sudo sed "s/fitlog.yourdomain.com/fitlog.jacobscy.xyz/g" /opt/fitlog/repo/deploy/nginx/fitlog.conf > /etc/nginx/sites-available/fitlog
sudo ln -sf /etc/nginx/sites-available/fitlog /etc/nginx/sites-enabled/fitlog
sudo nginx -t && sudo systemctl reload nginx

# 11. 验证
curl -I http://127.0.0.1/health
```

---

## 19. 日常增量更新部署流程 (Update Deployment)

代码在本地修改、测试通过并推送至 GitHub 后，在服务器执行标准化增量升级：

```bash
# 1. 登录服务�?ssh jacob@192.168.1.62

# 2. 进入仓库目录并拉取最新代�?cd /opt/fitlog/repo
sudo -u fitlog git pull --ff-only origin main

# 3. 后端更新 (依赖、Prisma 生成与迁�?
cd /opt/fitlog/repo/server
sudo -u fitlog npm ci --omit=dev
sudo -u fitlog npx prisma generate
sudo -u fitlog npx prisma migrate deploy

# 4. 前端打包与发�?cd /opt/fitlog/repo/client
sudo -u fitlog npm ci
sudo -u fitlog npm run build
sudo rm -rf /opt/fitlog/client/dist/*
sudo cp -r dist/* /opt/fitlog/client/dist/
sudo chown -R fitlog:fitlog /opt/fitlog/client/dist

# 5. 重启后端服务与重�?Nginx
sudo systemctl restart fitlog
sudo nginx -t && sudo systemctl reload nginx

# 6. 健康检�?curl -s http://127.0.0.1/health/ready | jq .
```

---

## 20. 服务日常运维管理与常用命令表

| 运维场景 | 执行命令 | 说明 |
|:---|:---|:---|
| **查看后端状�?* | `sudo systemctl status fitlog` | 检查是�?active (running) |
| **重启后端服务** | `sudo systemctl restart fitlog` | 优雅重载后端进程 |
| **停止后端服务** | `sudo systemctl stop fitlog` | 维护时暂停服�?|
| **实时日志跟踪** | `sudo journalctl -u fitlog -f -n 50` | 追踪最�?50 行实时日�?|
| **测试 Nginx 语法**| `sudo nginx -t` | 语法检查，避免重启挂掉 |
| **平滑重载 Nginx**| `sudo systemctl reload nginx` | 不断连接重载配置 |
| **Redis DB 1 测试**| `redis-cli -a '<REDIS_PASSWORD>' -n 1 ping` | 验证 FitLog 专享缓存 |
| **MySQL 状态确�?* | `sudo systemctl status mysql` | 检查主数据库健康度 |
| **Tunnel 状�?* | `sudo systemctl status cloudflared` | 检查公网隧道运行情�?|

---

## 21. 实时日志审计与流式排�?
- **后端标准输出日志**�?  ```bash
  sudo journalctl -u fitlog -f
  ```
- **Nginx 访问日志 (�?Request ID)**�?  ```bash
  sudo tail -f /var/log/nginx/access.log | grep fitlog
  ```
- **Nginx 错误日志**�?  ```bash
  sudo tail -f /var/log/nginx/error.log
  ```

---

## 22. 健康检查探针与接口验证

FitLog 提供多层健康检查端点，全部挂载�?`/health`�?
1. **基础活跃探针 (Liveness)**�?   ```bash
   curl -I https://fitlog.jacobscy.xyz/health/live
   # 期望返回：HTTP/2 200 OK
   ```
2. **就绪探针 (Readiness，深度检�?MySQL �?Redis)**�?   ```bash
   curl -s https://fitlog.jacobscy.xyz/health/ready
   # 期望返回�?   # {"status":"ok","database":"connected","redis":"connected","timestamp":"..."}
   ```
3. **公网动图响应头深度检�?*�?   ```bash
   curl -I https://fitlog.jacobscy.xyz/media/exercises-dataset/2gPfomN.gif
   # 必须包含�?   # Content-Type: image/gif
   # Cross-Origin-Resource-Policy: cross-origin
   ```

---

## 23. 生产备份机制与策�?
项目自带自动化备份脚本：`deploy/scripts/backup.sh`�?
### 23.1 手动触发完整备份
```bash
sudo /opt/fitlog/repo/deploy/scripts/backup.sh
```

### 23.2 备份内容与保留策�?- 自动导出 `fitlog_prod` 数据库的带事务压�?Dump (`.sql.gz`)�?- 自动归档 `/opt/fitlog/server/.env` 配置文件�?- 自动备份当前线上前端 `dist/` 压缩包�?- 备份目录存放�?`/opt/fitlog/backups/`�?- 默认自动清理超过 **7 �?* 的旧备份�?
---

## 24. 灾难数据恢复方案

若发生误操作或硬件损坏，使用 `deploy/scripts/restore.sh` 极速还原：

```bash
# 1. 停止后端写入
sudo systemctl stop fitlog

# 2. 执行恢复脚本 (指定备份时间戳对应的 sql.gz 文件)
sudo /opt/fitlog/repo/deploy/scripts/restore.sh /opt/fitlog/backups/fitlog_prod_20260905_180000.sql.gz

# 3. 重启后端服务
sudo systemctl start fitlog
```

---

## 25. 紧急版本回滚方�?(Rollback)

当发布的代码产生重大 Bug 时，执行以下两步回滚�?
### 25.1 代码与依赖回�?```bash
cd /opt/fitlog/repo

# 1. 回退到上一个已验证的稳�?commit
sudo -u fitlog git checkout <STABLE_COMMIT_HASH>

# 2. 重新编译前端与生�?Prisma Client
cd /opt/fitlog/repo/client && sudo -u fitlog npm run build
sudo rm -rf /opt/fitlog/client/dist/* && sudo cp -r dist/* /opt/fitlog/client/dist/

cd /opt/fitlog/repo/server && sudo -u fitlog npx prisma generate
sudo systemctl restart fitlog
```

### 25.2 数据库结构回滚说�?若涉�?Breaking 数据库变更，优先通过向前兼容方式部署修复，或通过还原迁移前由 `backup.sh` 产生�?Dump 文件恢复�?
---

## 26. PWA / Service Worker 缓存策略

�?`client/vite.config.js` 中精确配�?Workbox 路由缓存策略�?
- **HTML 入口文件**：`no-cache, no-store, must-revalidate`，确保用户每次刷新必拉取最新入口�?- **Service Worker 入口 (`sw.js`)**：`expires 0`，强制浏览器每次必进行字节级更新核查�?- **动作媒体 (`/media/exercises-dataset/.*`)**：采�?`StaleWhileRevalidate` 策略，缓存池名称升级�?**`media-exercises-v2`**，最大缓�?200 项，有效�?30 天�?- **异常响应保护**：`cacheableResponse: { statuses: [0, 200] }`，严格禁�?404/500 等错误状态码进入 CacheStorage�?
---

## 27. 生产踩坑记：媒体缓存与移动端跨源治理

> ⚠️ **此为本次真实部署中遭遇的核心疑难杂症与终极解决方案，务必牢记�?*

### 27.1 故障现象
- **PC 浏览�?*：第一页与第二页动作动图全部播放正常�?- **移动端浏览器 (真实荣耀手机)**：动作库第一页所有卡片全部显�?**“暂无演示预览�?*，翻到第二页却又全部正常显示�?
### 27.2 司法级排查根�?(Root Cause)
1. **历史 404 坏缓存污�?*：首次部署时物理动图文件拷贝存在微小时差，移动端�?18:27 首次请求第一页动图返回了 404。旧 Service Worker �?`CacheFirst` 策略将该 404 持久化保存在�?CacheStorage �?`media-exercises` 缓存池中�?2. **没有网络请求发出**：真实手机再次打开第一页时，直接命中本�?CacheStorage 里的 404，完全没有向网络发请求，直接触发 `<img>` �?`onError`，渲染兜底文案。第二页因首次部署未被访问，故无坏缓存�?3. **Cloudflare 强缓存导致旧 SW 无法更新**：早�?Nginx 对静�?`.js` 设置�?`immutable`，导�?Cloudflare 边缘节点将旧�?`sw.js` 缓存�?1 年；真实手机后台检�?`sw.js` 更新时永远拿到相同的旧字节，�?SW 从未被激活�?4. **CORP 跨源阻断**：Cloudflare 历史缓存对第一页动图返回了 `cross-origin-resource-policy: same-origin`，加剧了沙箱阻断�?
### 27.3 终极修复方案
1. **缓存池版本迭�?*：由 `media-exercises` 升级�?`media-exercises-v2`�?2. **应用入口无感自愈**：在 `client/src/main.jsx` 启动阶段执行 `caches.delete('media-exercises')`，旧用户打开即自动蒸发坏缓存，无需用户手动清缓存�?3. **Nginx 禁用 SW 缓存**：对 `sw.js` �?`registerSW.js` 设置 `no-store, must-revalidate`�?4. **规范跨源响应�?*：源�?Nginx �?`/media/` 强制输出 `Cross-Origin-Resource-Policy: cross-origin` �?`Access-Control-Allow-Origin: *`�?5. **Cloudflare 精准 Purge**：在 Cloudflare Dashboard 中针对以�?URL 执行 **Custom Purge**（绝不使�?Purge Everything）：
   - `https://fitlog.jacobscy.xyz/sw.js`
   - `https://fitlog.jacobscy.xyz/media/exercises-dataset/2gPfomN.gif`

---

## 28. 常见生产故障排查手册

### 28.1 访问返回 502 Bad Gateway
- 检�?FitLog 后端服务是否存活：`sudo systemctl status fitlog`�?- 确认端口是否匹配：FitLog 默认监听 `3001`，确�?`fitlog.conf` �?`upstream fitlog_backend` 指向 `127.0.0.1:3001`�?- 查看 systemd 崩溃原因：`sudo journalctl -u fitlog -n 50 --no-pager`�?
### 28.2 手机号登录提示系统繁�?/ 限流
- 检�?Redis 是否正常运行：`redis-cli -a '<REDIS_PASSWORD>' -n 1 ping`�?- 检查短信提供商配置：当前默认配置为 `SMS_PROVIDER=mock`，验证码已直接打印在服务�?Dev Console 中（或使用通用验证码）�?
### 28.3 动作动图无法显示 / 提示“暂无演示预览�?- 使用浏览器打开司法诊断页面：`https://fitlog.jacobscy.xyz/debug-media.html` 查看底层 `caches.keys()` �?`<img>` 加载报错�?- 验证源站物理文件是否存在：`ls -lh /opt/fitlog/repo/data/exercises-media/`�?
---

## 29. 生产安全合规与操作禁�?
> [!CAUTION]
> **以下为最高级别生产安全禁令，违者将导致不可逆数据损坏或安全事故�?*
> 1. **严禁将真实密码与密钥提交�?Git 仓库**（`.env` 文件必须�?`.gitignore` 排除）�?> 2. **严禁�?`root` 用户启动 Node.js 进程**（必须由 `fitlog` 运行）�?> 3. **严禁在生�?Redis 上执�?`FLUSHALL`**（将直接冲毁 NetDisk DB 0 缓存）�?> 4. **严禁修改 `/etc/nginx/sites-available/netdisk`**（保持多业务绝对隔离）�?> 5. **严禁�?Cloudflare 执行 `Purge Everything`**（仅允许针对 FitLog 独立 URL �?Custom Purge）�?> 6. **严禁在生产数据库执行 `DROP DATABASE`、`TRUNCATE` �?`prisma db push`**�?
---

## 30. 生产配置清单�?Secret Inventory

### 30.1 生产配置清单 (Configuration Matrix)

| 配置�?| 生产实际配置�?| 是否为敏感项 (Secret) | 备注说明 |
|:---|:---|:---|:---|
| **生产公网地址** | `https://fitlog.jacobscy.xyz` | �?| Cloudflare Tunnel 暴露 |
| **服务器局域网 IP**| `192.168.1.62` | �?| Ubuntu 24.04 宿主�?|
| **SSH 运维用户** | `jacob` | �?| 具备 sudo 提权能力 |
| **应用运行用户** | `fitlog` | �?| 最小权限系统运行用�?|
| **后端运行端口** | `3001` | �?| 避免�?3000(Open-WebUI) 冲突 |
| **MySQL 生产库名**| `fitlog_prod` | �?| 字符�?`utf8mb4_unicode_ci` |
| **MySQL 用户�?* | `fitlog_user` | �?| 仅限 `127.0.0.1` 本地连接 |
| **Redis 隔离分库** | `DB 1` | �?| NetDisk 独占 DB 0 |
| **短信提供商模�?*| `mock` | �?| 当前生产手机�?密码主入�?|
| **MySQL 密码** | `<FITLOG_DB_PASSWORD>` | **�?(YES)** | 仅存放在 `/opt/fitlog/server/.env` |
| **Redis 密码** | `<REDIS_PASSWORD>` | **�?(YES)** | 仅存放在 `/opt/fitlog/server/.env` |
| **JWT Access 密钥**| `<FITLOG_JWT_ACCESS_SECRET>` | **�?(YES)** | 仅存放在 `/opt/fitlog/server/.env` |
| **JWT Refresh 密钥**| `<FITLOG_JWT_REFRESH_SECRET>` | **�?(YES)** | 仅存放在 `/opt/fitlog/server/.env` |

### 30.2 生产敏感凭证目录 (Secret Inventory)

| 凭证名称 | 业务用�?| 物理存放位置 | 访问权限 | 轮换机制 (Rotation) |
|:---|:---|:---|:---|:---|
| `DATABASE_URL` | 后端连接 MySQL 进行数据读写 | `/opt/fitlog/server/.env` | `600` (fitlog:fitlog) | �?MySQL 执行 `ALTER USER` 后同步修�?`.env` 并重�?`fitlog` |
| `REDIS_URL` | 后端连接 Redis DB 1 存取缓存与限�?| `/opt/fitlog/server/.env` | `600` (fitlog:fitlog) | �?`/etc/redis/redis.conf` 修改后同步修�?`.env` 并重启服�?|
| `JWT_ACCESS_SECRET`| 签名 15 分钟短效 Access Token | `/opt/fitlog/server/.env` | `600` (fitlog:fitlog) | 使用 `openssl rand -hex 32` 生成，更新后重启，用户短�?Token 轮换 |
| `JWT_REFRESH_SECRET`| 签名 7 天长�?Refresh Token | `/opt/fitlog/server/.env` | `600` (fitlog:fitlog) | 使用 `openssl rand -hex 32` 生成，更新将使用户重新登录一�?|

---

## 附录 A：一键部署脚本使用说�?
项目根目录下提供全自�?11 步部署脚本：`deploy/scripts/deploy.sh`�?
```bash
# 赋予执行权限
chmod +x /opt/fitlog/repo/deploy/scripts/deploy.sh

# 完整自动执行 (预检、备份、迁移、构建、发布、重启、健康核�?
sudo /opt/fitlog/repo/deploy/scripts/deploy.sh

# 可选参数运�?sudo /opt/fitlog/repo/deploy/scripts/deploy.sh --skip-build    # 跳过前端打包
sudo /opt/fitlog/repo/deploy/scripts/deploy.sh --skip-backup   # 跳过前期快照
```

---

## 附录 B：上线最终验�?Checklist

在每次执行发布上线后，必须逐项核对完成以下验证�?
- [ ] `systemctl is-active fitlog` 状态为 `active`
- [ ] `curl -s http://127.0.0.1/health/ready | grep -o '"status":"ok"'` 输出正常
- [ ] Nginx 语法测试 `nginx -t` 成功
- [ ] 公网访问 `https://fitlog.jacobscy.xyz` 正常展示登录/首页
- [ ] 动作库列�?`https://fitlog.jacobscy.xyz/exercises` 正常加载第一�?- [ ] 真实手机访问第一页动图播放正常，无“暂无演示预览”兜底文�?- [ ] 真实手机翻至第二页，动图加载流畅正常
- [ ] 手机�?+ 密码真实登录�?Session 维持正常
- [ ] `journalctl -u fitlog -n 20` 无未捕获异常抛出
- [ ] 确认本次部署未修�?NetDisk 相关服务及配�?