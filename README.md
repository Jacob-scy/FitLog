# FitLog — 健身训练记录

面向个人的全栈健身训练记录应用，覆盖「动作库检索 → 训练录入 → 日历打卡 → 数据统计」闭环。

## 核心功能

| 模块 | 说明 |
|---|---|
| 动作库 | 内置动作库（`data/exercises.json`，实测 1324 条动作元数据），支持肌群 / 器械 / 难度筛选、动作详情、收藏夹 |
| 训练录入 | 训练记录器：按动作录入组数 / 次数 / 重量，支持加载训练模板快速开始 |
| 训练历史 | 历史列表与单次训练详情，支持编辑备注与结束时间 |
| 训练日历 | 月视图网格，训练日高亮 + 月度统计 |
| 数据统计 | 训练总览、已练动作、单动作历史指标（Recharts 图表） |
| 身体数据 | 体重 / 体脂 / 围度录入、历史与体重趋势图 |
| 训练模板 | 模板创建 / 删除 / 加载 |
| 数据导出 | 训练数据导出 |
| 账号体系 | JWT 双 Token 登录，个人资料（昵称 / 头像）与训练统计 |

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 18.3 + Vite 6 + Tailwind CSS 3.4 + Zustand 5 + React Router 6 + Recharts，vite-plugin-pwa（Workbox）支持 PWA |
| 后端 | Node.js + Express 4.21 + Prisma 6 ORM + Zod 校验，helmet / express-rate-limit / morgan |
| 数据库 | MySQL 8.0 |
| 缓存 | Redis（ioredis） |
| 认证 | JWT 双 Token（Access 15min / Refresh 30d，HttpOnly Cookie） |

## 本地开发

```bash
# 后端（默认 port 3001）
cd server && npm install && npm run dev

# 前端（默认 port 5173）
cd client && npm install && npm run dev
```

其余常用命令：

```bash
cd server && npx prisma migrate dev   # 数据库迁移
cd server && npm test                 # 运行测试
cd client && npm run build            # 生产构建
cd client && npm run preview          # 预览生产构建
```

环境变量：仓库提供 `.env.docker.example` 与 `.env.production.example`，按需复制为 `.env` 后填写。

## 目录结构

```
FitLog/
├── client/                 # React 18 + Vite 前端
│   └── src/{pages,components,stores,api,utils,constants}
├── server/                 # Express + Prisma 后端
│   ├── src/{modules,config,lib,middleware}
│   └── prisma/{schema.prisma,migrations}
├── data/                   # 动作元数据与动作图片
├── deploy/                 # nginx / systemd / 证书等部署配置
├── scripts/                # 工具与测试脚本
└── docs/                   # PRD / API / 部署文档
```

后端模块：`auth`、`exercise`、`workout`、`stats`、`template`、`measurement`、`favorite`、`export`、`user`、`health`。

## 线上地址

| 项 | 值 |
|---|---|
| 站点 | https://fitlog.jacobscy.xyz |
| 健康端点 | https://fitlog.jacobscy.xyz/health（返回 JSON `{"status":"ok",...}`） |
| 状态 | ✅ 已上线 |
| 部署 | Docker Compose + Nginx + Cloudflare Tunnel |

该站点已接入 [Navigation 个人门户](../Navigation) 联邦卡片，由门户每 5 分钟探活。

## 文档

| 文档 | 路径 |
|---|---|
| 需求文档 | `docs/FitLog_Web_PRD_v4.0.md` |
| API 文档 | `docs/API.md` |
| 部署文档 | `docs/DEPLOY.md` |
| 进度文档 | `PROGRESS.md` |
| AI 协作规范 | `CLAUDE.md` / `AGENT_RULES.md` |
