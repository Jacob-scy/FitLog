# CLAUDE.md — FitLog 训练记录应用

> 本项目遵循 [PersonalProjects 工作空间开发规范](../docs/architecture.md)、[业务规则](../docs/business-rules.md)、[审查清单](../docs/review.md)。

---

## 技术栈

| 层 | 技术 |
|---|------|
| 前端 | React 18 + Vite + Tailwind CSS v3 + Zustand |
| 后端 | Node.js + Express + Prisma ORM |
| 数据库 | MySQL 8.0 |
| 认证 | JWT 双 Token（Access 15min / Refresh 30d HttpOnly Cookie） |
| PWA | vite-plugin-pwa (Workbox) |
| 图表 | Recharts |

## 常用命令

```
# 后端
cd FitLog/server && npm run dev       # 开发服务器 (port 3000)
cd FitLog/server && npx prisma migrate dev  # 数据库迁移
cd FitLog/server && npm test           # 运行测试

# 前端
cd FitLog/client && npm run dev        # 开发服务器 (port 5173)
cd FitLog/client && npm run build      # 生产构建
cd FitLog/client && npx tsc --noEmit   # 类型检查
```

## 项目文档

| 文档 | 路径 | 说明 |
|------|------|------|
| 需求文档 | `docs/FitLog_Web_PRD_v4.0.md` | 完整 PRD，含 API/DB/PWA 规范 |
| 进度文档 | `PROGRESS.md` | 每次开发后必须更新 |
| 架构规范 | （待阶段 1 创建） | `docs/architecture.md` |
| 业务规则 | （待阶段 1 创建） | `docs/business-rules.md` |

## 开发流程

1. 阅读 PRD + PROGRESS.md 了解当前进度
2. 按照 `../docs/architecture.md` 分层规范编码
3. 遵守 `../docs/business-rules.md` 业务规则
4. 构建验证（后端编译 + 前端 tsc + build）
5. 更新 PROGRESS.md

## 当前状态

- **阶段 0 完成**：数据已下载，1324 个动作 + 1746 张 JPG
- **下一步**：阶段 1 — 项目骨架 + 数据库 + 认证
- 数据文件：`data/exercises.json` + `data/free-exercise-db/`
