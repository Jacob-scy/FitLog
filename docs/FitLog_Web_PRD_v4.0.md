# FitLog Web 训练记录应用
## 产品需求文档 (PRD) V4.0 — 独立开发执行版

| 字段 | 内容 |
|------|------|
| 文档版本 | v4.0.0 |
| 发布日期 | 2026-05-31 |
| 作者 | 独立开发者 |
| 状态 | **定稿·可执行** |
| 相对 v3.0 核心更新 | 技术栈收口定案、补全认证策略、定义 1RM 公式、完善数据模型、新增分页/导出/索引规范 |

---

## 目录

1. 产品概述
2. 技术栈（定案）
3. 系统架构
4. 动作媒体库专章
5. 认证与安全
6. 核心功能需求（用户故事）
7. 数据模型（完整版）
8. API 接口规范
9. 数据库设计
10. 非功能性指标
11. 开发里程碑

---

## 1. 产品概述

FitLog Web 是面向健身爱好者的**响应式 PWA 训练记录工具**。核心设计原则：

- **Mobile-First**：针对单手握机、健身房弱网场景深度优化
- **去云化极简架构**：零云厂商依赖，所有资源本地闭环
- **防丢失优先**：本地草稿自动存储，任何崩溃场景可 100% 恢复
- **数据资产化**：长期训练数据沉淀，支持力量增长可视化分析

**目标用户**：每周训练 3 次以上、有记录习惯的健身爱好者（中级及以上）

---

## 2. 技术栈（定案）

> ⚠️ **本章为最终定案，禁止在开发过程中再做选型比较，避免决策疲劳。**

| 层级 | 技术选型 | 选型理由 |
|------|----------|----------|
| 前端框架 | **React 18 + Vite** | 生态最大，ChatGPT/Claude 辅助编码质量最高 |
| 前端样式 | **Tailwind CSS v3** | 原子化类，移动端适配极速，无需写 CSS 文件 |
| 前端状态 | **Zustand** | 比 Redux 轻量，比 Context 性能好，solo dev 友好 |
| PWA | **vite-plugin-pwa (Workbox)** | 官方方案，Service Worker 自动生成 |
| 后端框架 | **Node.js + Express** | JS 全栈统一语言，降低上下文切换成本 |
| ORM | **Prisma** | 类型安全，迁移管理清晰，适合 MySQL |
| 数据库 | **MySQL 8.0+** | 关系型聚合查询，长期数据分析基础 |
| 认证 | **JWT (Access + Refresh Token 双 Token)** | 见第 5 章 |
| 图表库 | **Recharts** | React 生态原生，声明式 API |
| 部署 | **单台 Linux (Ubuntu 22.04) + Nginx** | 低成本，Nginx 兼做静态伺服 + 反代 |
| 媒体格式 | **动态 WebP** | 见第 4 章 |
| 开发环境 | **Windows + WSL2** | Python 脚本在 WSL2 内执行 |

---

## 3. 系统架构

```
┌─────────────────────────────────────────────────┐
│                   用户设备 (手机/PC)               │
│  React SPA (PWA)                                 │
│  ├── Service Worker (Workbox)                    │
│  │   ├── 静态资源缓存 (Cache First)              │
│  │   └── WebP 媒体预缓存 (Precaching)            │
│  └── LocalStorage (训练草稿 JSON)                │
└────────────────────┬────────────────────────────┘
                     │ HTTPS
┌────────────────────▼────────────────────────────┐
│                  Linux Server                    │
│  Nginx                                          │
│  ├── / → /var/www/fitlog/dist/ (前端静态文件)   │
│  ├── /api/ → localhost:3001 (Express 反代)      │
│  └── /media/ → /var/www/media/ (WebP 直出)     │
│                                                 │
│  Node.js / Express (port 3001)                  │
│  ├── JWT 鉴权中间件                              │
│  ├── Rate Limiter (express-rate-limit)          │
│  └── Prisma ORM → MySQL 8.0                    │
└─────────────────────────────────────────────────┘
```

**关键约定：**
- 前端 `vite.config.js` 中 `base: '/'`，生产构建输出到 `/dist`
- 所有 API 请求路径前缀为 `/api/v1/`
- 媒体资源通过 Nginx 直出，不经过 Node.js 进程

---

## 4. 动作媒体库专章

### 4.1 媒体格式规范

| 项目 | 规范 |
|------|------|
| 格式 | **动态 WebP**，无声音，自动循环 |
| 分辨率 | 480×270（16:9）或 400×400（1:1），取决于动作展示需求 |
| 时长 | 截取核心动作 **2–3 秒**，循环播放 |
| 文件大小 | 目标 **< 200KB**，上限 400KB |
| 命名规范 | `{exercise_id}_{version}.webp`，如 `ex_001_benchpress_v1.webp` |
| 存储路径 | 服务器 `/var/www/media/exercises/` |
| 前端渲染 | `<img src="/media/exercises/xxx.webp" loading="lazy" />` |
| 无媒体降级 | `media_url` 为 null 时，显示目标肌群的肌肉图占位符 SVG |

### 4.2 数据冷启动方案（Python 自动化）

**推荐路径：ExerciseDB API + FFmpeg**

**Step 1：抓取数据**
```python
# fetch_exercises.py
import requests, json, time, os

HEADERS = {"X-RapidAPI-Key": "YOUR_KEY", "X-RapidAPI-Host": "exercisedb.p.rapidapi.com"}
BASE_URL = "https://exercisedb.p.rapidapi.com/exercises"

def fetch_all_exercises():
    all_exercises = []
    offset = 0
    limit = 100
    while True:
        res = requests.get(f"{BASE_URL}?limit={limit}&offset={offset}", headers=HEADERS)
        data = res.json()
        if not data:
            break
        all_exercises.extend(data)
        offset += limit
        time.sleep(0.5)  # 避免触发 rate limit
    return all_exercises

exercises = fetch_all_exercises()
with open("raw_exercises.json", "w") as f:
    json.dump(exercises, f, ensure_ascii=False, indent=2)
```

**Step 2：批量转换为 WebP（使用 FFmpeg，比 Pillow 更可靠）**
```python
# convert_to_webp.py
import subprocess, os, json

with open("raw_exercises.json") as f:
    exercises = json.load(f)

os.makedirs("./webp_media", exist_ok=True)

for ex in exercises:
    gif_path = f"./raw_media/{ex['id']}.gif"
    webp_path = f"./webp_media/{ex['id']}.webp"

    if not os.path.exists(gif_path):
        continue

    # FFmpeg：截取前3秒、缩放至480x270、导出高压缩比 WebP
    cmd = [
        "ffmpeg", "-i", gif_path,
        "-t", "3",                          # 截取前3秒
        "-vf", "scale=480:270:flags=lanczos,fps=12",  # 降帧至12fps
        "-loop", "0",                       # 无限循环
        "-compression_level", "6",          # 0(快/大) ~ 6(慢/小)
        "-quality", "70",                   # WebP 质量 0~100
        "-y", webp_path
    ]
    result = subprocess.run(cmd, capture_output=True)
    if result.returncode == 0:
        size_kb = os.path.getsize(webp_path) / 1024
        print(f"✅ {ex['id']}.webp — {size_kb:.1f} KB")
    else:
        print(f"❌ Failed: {ex['id']} — {result.stderr.decode()}")
```

> ⚠️ **版权注意事项**：ExerciseDB 数据仅限个人/非商业使用。若未来商业化，需替换为自拍素材或购买 Envato Elements 商用授权包（搜索 "Fitness Exercise Animation"）。

**Step 3：写入数据库**
```python
# seed_db.py - 运行于部署服务器，在 Prisma migrate 之后执行
import mysql.connector, json

conn = mysql.connector.connect(host="localhost", user="fitlog", password="xxx", database="fitlog")
cursor = conn.cursor()

with open("raw_exercises.json") as f:
    exercises = json.load(f)

for ex in exercises:
    cursor.execute("""
        INSERT INTO exercises (id, name, target_muscle, equipment, media_url, is_official)
        VALUES (%s, %s, %s, %s, %s, 1)
        ON DUPLICATE KEY UPDATE name=VALUES(name)
    """, (
        ex["id"],
        ex["name"],
        ex["target"],
        ex.get("equipment", "unknown"),
        f"/media/exercises/{ex['id']}.webp"
    ))

conn.commit()
cursor.close()
conn.close()
```

---

## 5. 认证与安全

### 5.1 双 Token 策略（PWA 必须）

```
Access Token:  有效期 15 分钟，存于内存（React State / Zustand）
Refresh Token: 有效期 30 天，存于 HttpOnly Cookie（防 XSS）
```

**刷新流程：**
```
前端请求 → Access Token 过期 (401) → 自动调用 POST /api/v1/auth/refresh
  ├── Refresh Token 有效 → 下发新 Access Token → 重试原请求
  └── Refresh Token 过期 → 清除状态 → 跳转登录页
```

**Axios 拦截器实现要点：**
```javascript
// 需要一个 isRefreshing 标志 + 请求队列，避免并发请求时多次触发刷新
let isRefreshing = false;
let failedQueue = [];
```

### 5.2 邮箱验证码登录

| 项目 | 规范 |
|------|------|
| 验证码长度 | 6 位数字 |
| 有效期 | 10 分钟 |
| Rate Limit | 同一邮箱：每小时最多 5 次；同一 IP：每小时最多 10 次 |
| 存储 | Redis（推荐）或 MySQL + 定时清理；**禁止明文存入** |
| 发送服务 | 阿里云邮件推送（国内送达率最高）或 Resend.com |

### 5.3 越权防护（必须在每个 Controller 验证）

```javascript
// 中间件示例：确保资源属于当前用户
const assertOwnership = async (req, res, next) => {
  const workout = await prisma.workoutRecord.findUnique({
    where: { id: req.params.id }
  });
  if (!workout || workout.userId !== req.user.id) {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
};
```

---

## 6. 核心功能需求（用户故事）

### US-01：用户注册与登录 (P0)

**用户故事**：作为健身爱好者，我希望通过邮箱验证码安全登录，数据同步云端且不被他人越权访问。

| AC 编号 | 验收标准 |
|---------|----------|
| AC-01.1 | 发送验证码：Rate Limit 生效（邮箱维度 + IP 维度），超限返回 `429 Too Many Requests` |
| AC-01.2 | 验证码 10 分钟内有效，过期后需重新发送 |
| AC-01.3 | 登录成功：Access Token 存于内存，Refresh Token 以 HttpOnly Cookie 下发 |
| AC-01.4 | 越权测试：用户 A 尝试读写用户 B 的任何资源，后端返回 `403 Forbidden` |
| AC-01.5 | 登出：服务端 Refresh Token 加入黑名单（或从 DB 删除），客户端清除 Access Token |

---

### US-02：官方动作库与自定义动作 (P0)

**用户故事**：作为训练者，我希望在动作列表中看到动态缩略图跟练，同时能添加自定义动作。

| AC 编号 | 验收标准 |
|---------|----------|
| AC-02.1 | 动作列表支持**分页**（每页 20 条）+ 按名称/肌群**筛选**，首屏渲染 < 300ms |
| AC-02.2 | WebP 动图以 `<img loading="lazy">` 渲染，滚动时懒加载，不打断页面滑动 |
| AC-02.3 | `media_url` 为 null 时显示目标肌群的占位 SVG，不出现破图 |
| AC-02.4 | 新建自定义动作：必填[动作名称]、[目标肌群]；选填[器械类型]、[备注] |
| AC-02.5 | 自定义动作仅自己可见，不影响其他用户的动作库 |
| AC-02.6 | 删除有关联训练记录的动作时，前端弹出二次确认弹窗，后端执行**软删除**（`deleted_at`），历史记录保留 |

---

### US-03：训练录入执行与防丢失 (P0)

**用户故事**：作为在健身房训练的用户，我希望录入极度顺滑且能应对切屏杀后台，绝不丢失今天的记录。

| AC 编号 | 验收标准 |
|---------|----------|
| AC-03.1 | 所有可点击热区 ≥ 44×44px（符合 Apple HIG 标准） |
| AC-03.2 | 重量/次数输入框：强制拉起数字键盘 `inputmode="decimal"`；获焦后页面自动上滚，焦点距软键盘顶部 ≥ 40px |
| AC-03.3 | **Auto-Save**：每次修改重量、次数、勾选完成状态，500ms 防抖后写入 LocalStorage，Key 为 `fitlog_draft_{userId}` |
| AC-03.4 | **中断恢复**：用户访问首页时，检测到 LocalStorage 草稿（且草稿时间戳 < 24 小时），弹出恢复提示；选择"恢复"则 100% 还原进度；选择"放弃"则清除草稿 |
| AC-03.5 | **草稿冲突处理**：若服务端已存在比草稿时间戳更新的已完成训练，则恢复提示中注明"此草稿可能与已保存记录冲突"，由用户决定 |
| AC-03.6 | 训练完成提交时，先调用 `POST /api/v1/workouts`，成功后清除 LocalStorage 草稿 |
| AC-03.7 | 组间计时器：每完成一组后，界面显示倒计时（默认 90 秒，用户可自定义），计时完成震动提示（`navigator.vibrate`） |

---

### US-04：深度数据统计 (P1)

**用户故事**：作为硬核训练者，我希望通过图表看到力量增长曲线和组间休息分析，以科学评估进步。

| AC 编号 | 验收标准 |
|---------|----------|
| AC-04.1 | **1RM 计算公式（定案：Epley 公式）**：`1RM = weight × (1 + reps / 30)`；仅当 `reps >= 2` 时计算，单次最大重量（reps=1）直接取 `weight` 值 |
| AC-04.2 | **组间休息**：前端在每组完成时记录 `completed_at` 时间戳落盘；`actual_rest_time_sec = 下一组 completed_at - 本组 completed_at`（第一组为 0） |
| AC-04.3 | 图表1：所选动作**过去 90 天** 1RM 趋势折线图，X 轴为日期，Y 轴为 kg，每次训练取当日最高 1RM |
| AC-04.4 | 图表2：所选动作**过去 90 天**每次训练的平均组间休息时长柱状图，X 轴为日期 |
| AC-04.5 | 图表数据接口支持 `?days=30/90/180/365` 参数切换时间范围 |

---

### US-05：数据导出 (P2)

**用户故事**：作为数据所有者，我希望能导出我的全部训练数据，以防平台停服或迁移到其他工具。

| AC 编号 | 验收标准 |
|---------|----------|
| AC-05.1 | 支持导出**全量训练记录**为 JSON 格式，包含所有组次数据 |
| AC-05.2 | 支持导出为**CSV 格式**（每行一个 Set），便于 Excel 分析 |
| AC-05.3 | 导出接口为异步任务（大数据量），完成后提供下载链接或直接下载文件 |
| AC-05.4 | 导出功能有 Rate Limit：每用户每天最多 3 次 |

---

## 7. 数据模型（完整版）

### 7.1 训练 Payload（前后端接口约定）

```json
{
  "workout_record": {
    "record_id": "rec_9f8d7e6c",
    "user_id": "usr_123456",
    "start_time": "2026-05-31T18:00:00.000Z",
    "end_time": "2026-05-31T19:30:00.000Z",
    "notes": "今天状态很好",
    "total_volume_kg": 4550,
    "exercises": [
      {
        "exercise_id": "ex_001_benchpress",
        "exercise_name": "杠铃卧推",
        "target_muscle": "chest",
        "media_url": "/media/exercises/ex_001_benchpress_v1.webp",
        "sort_order": 1,
        "sets": [
          {
            "set_index": 1,
            "set_type": "warmup",
            "weight": 60,
            "reps": 12,
            "rpe": 5.0,
            "completed_at": "2026-05-31T18:05:00.000Z",
            "actual_rest_time_sec": 0,
            "is_completed": true
          },
          {
            "set_index": 2,
            "set_type": "standard",
            "weight": 100,
            "reps": 5,
            "rpe": 8.0,
            "completed_at": "2026-05-31T18:07:55.000Z",
            "actual_rest_time_sec": 115,
            "is_completed": true
          }
        ]
      }
    ]
  }
}
```

**字段说明：**
- `end_time`：v3.0 缺失，**必须新增**，用于计算总训练时长
- `completed_at`（每 Set）：**必须新增**，用于精确计算组间休息（比 T2-T1 差分更可靠）
- `total_volume_kg`：**由前端计算**（`Σ weight × reps`），后端存储前校验（允许 ±1 误差）
- `rpe`：0–10 的 0.5 步进值，**所有 set 均需此字段**（可为 null，不可缺失）
- `media_url`：**可为 null**（自定义动作无图），前端须处理 null 降级

---

## 8. API 接口规范

### 8.1 通用约定

```
Base URL:    https://yourdomain.com/api/v1
Auth Header: Authorization: Bearer {access_token}
Content-Type: application/json
错误响应格式: { "error": "错误描述", "code": "ERROR_CODE" }
分页参数:    ?page=1&limit=20 → 响应包含 { data: [], total, page, limit }
```

### 8.2 接口列表

| 模块 | 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|------|
| 认证 | POST | `/auth/send-code` | 发送邮箱验证码 | ❌ |
| 认证 | POST | `/auth/login` | 验证码登录/注册 | ❌ |
| 认证 | POST | `/auth/refresh` | 刷新 Access Token | ❌（Cookie） |
| 认证 | POST | `/auth/logout` | 登出，废弃 Refresh Token | ✅ |
| 动作库 | GET | `/exercises` | 动作列表（分页+筛选） | ✅ |
| 动作库 | POST | `/exercises` | 新建自定义动作 | ✅ |
| 动作库 | DELETE | `/exercises/:id` | 软删除动作（检查关联） | ✅ |
| 训练 | POST | `/workouts` | 提交训练记录 | ✅ |
| 训练 | GET | `/workouts` | 历史训练列表（分页） | ✅ |
| 训练 | GET | `/workouts/:id` | 训练详情 | ✅ |
| 训练 | DELETE | `/workouts/:id` | 删除训练记录 | ✅ |
| 统计 | GET | `/stats/exercise/:id` | 指定动作的 1RM 趋势 + 休息分析 | ✅ |
| 导出 | POST | `/export` | 触发数据导出（JSON/CSV） | ✅ |

---

## 9. 数据库设计

### 9.1 Prisma Schema

```prisma
// schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "mysql"
  url      = env("DATABASE_URL")
}

model User {
  id              String    @id @default(cuid())
  email           String    @unique
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  workouts        WorkoutRecord[]
  customExercises Exercise[] @relation("CustomExercises")
  refreshTokens   RefreshToken[]
}

model RefreshToken {
  id          String   @id @default(cuid())
  token       String   @unique @db.VarChar(512)
  userId      String
  expiresAt   DateTime
  revokedAt   DateTime?
  createdAt   DateTime @default(now())
  user        User     @relation(fields: [userId], references: [id])

  @@index([userId])
}

model Exercise {
  id            String    @id @default(cuid())
  name          String    @db.VarChar(100)
  targetMuscle  String    @db.VarChar(50)
  equipment     String?   @db.VarChar(50)
  mediaUrl      String?   @db.VarChar(255)
  isOfficial    Boolean   @default(false)
  createdById   String?   // null = 官方动作，有值 = 自定义
  deletedAt     DateTime? // 软删除
  createdAt     DateTime  @default(now())
  creator       User?     @relation("CustomExercises", fields: [createdById], references: [id])
  exerciseSets  ExerciseSet[]

  @@index([createdById])
  @@index([targetMuscle])
}

model WorkoutRecord {
  id             String    @id @default(cuid())
  userId         String
  startTime      DateTime
  endTime        DateTime?
  notes          String?   @db.Text
  totalVolumeKg  Float     @default(0)
  createdAt      DateTime  @default(now())
  user           User      @relation(fields: [userId], references: [id])
  exerciseSets   ExerciseSet[]

  @@index([userId, startTime])  // 历史列表查询
}

model ExerciseSet {
  id                  String    @id @default(cuid())
  workoutRecordId     String
  exerciseId          String
  sortOrder           Int       // 动作在此次训练中的顺序
  setIndex            Int       // 组次序号
  setType             String    @db.VarChar(20) // warmup / standard / dropset / failure
  weight              Float
  reps                Int
  rpe                 Float?    // 0~10
  completedAt         DateTime? // 组次完成时间戳
  actualRestTimeSec   Int       @default(0)
  isCompleted         Boolean   @default(false)
  workout             WorkoutRecord @relation(fields: [workoutRecordId], references: [id], onDelete: Cascade)
  exercise            Exercise      @relation(fields: [exerciseId], references: [id])

  // 关键查询索引（统计图表依赖）
  @@index([exerciseId, completedAt])           // 1RM 趋势查询
  @@index([workoutRecordId])
  @@index([exerciseId, workoutRecordId])
}
```

### 9.2 1RM 聚合查询示例

```sql
-- 查询指定动作过去 90 天每日最高 1RM（Epley 公式）
SELECT
  DATE(es.completed_at) AS train_date,
  MAX(es.weight * (1 + es.reps / 30.0)) AS daily_max_1rm
FROM exercise_sets es
JOIN workout_records wr ON es.workout_record_id = wr.id
WHERE
  wr.user_id = ?
  AND es.exercise_id = ?
  AND es.reps >= 2
  AND es.is_completed = TRUE
  AND es.completed_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)
GROUP BY DATE(es.completed_at)
ORDER BY train_date ASC;
```

---

## 10. 非功能性指标

| 指标 | 目标值 | 验收方法 |
|------|--------|----------|
| FCP（首次内容绘制） | < 2.0s（4G） | Lighthouse 移动端模拟 |
| PWA 二次访问 | < 0.5s（离线/弱网） | Chrome DevTools 离线模式 |
| WebP 媒体加载 | 单张 < 500ms（WiFi） | Network 面板瀑布图 |
| API P95 响应时间 | < 200ms | 本地压测（autocannon） |
| 训练提交防重复 | 前端提交按钮加载态 + 后端幂等 Key | 手动测试快速双击 |
| 数据安全 | 全站 HTTPS，Nginx 强制跳转 | SSL Labs A 级评分 |

**PWA Service Worker 缓存策略：**

| 资源类型 | 策略 |
|----------|------|
| HTML / JS / CSS | Cache First（版本更新时 precache） |
| `/media/exercises/*.webp` | Cache First + 预缓存前 50 个热门动作 |
| `/api/v1/exercises` | Network First + 1小时缓存兜底 |
| `/api/v1/workouts` | Network Only（数据实时性要求高） |

**数据库约束：**
- 严禁将训练数据落为 JSON 大字段，必须拆表存储（`workout_records` + `exercise_sets`）
- 所有聚合查询列（`exercise_id`, `user_id`, `completed_at`）必须有索引（见 Schema）

---

## 11. 开发里程碑

| 阶段 | 目标 | 核心交付物 | 预估周期 |
|------|------|------------|----------|
| **M0** | 环境搭建 | Linux 服务器 + Nginx + MySQL + Node 部署通 | 1–2 天 |
| **M1** | 数据基础 | Python 脚本跑通 ExerciseDB 抓取 + WebP 转换 + 入库 | 3–5 天 |
| **M2** | 认证核心 | 双 Token 登录注册，越权防护测试通过 | 3–4 天 |
| **M3** | 训练录入 MVP | US-03 全部 AC 通过，含 Auto-Save 恢复 | 5–7 天 |
| **M4** | 动作库 | US-02 全部 AC 通过，WebP 展示正常 | 3–4 天 |
| **M5** | PWA 化 | Service Worker 接入，离线可用，可添加主屏幕 | 2–3 天 |
| **M6** | 数据统计 | US-04 图表 + 1RM 趋势可视化 | 4–5 天 |
| **M7** | 收尾 | 数据导出 + 性能调优 + HTTPS + Lighthouse ≥ 90 | 3–4 天 |

**总预估：约 25–35 个开发日（每日 3–4 小时有效编码）**

---

## 附录：开发注意事项

1. **Prisma 迁移流程**：`npx prisma migrate dev --name <描述>` → 开发；`npx prisma migrate deploy` → 生产。**禁止直接改生产数据库表结构**。

2. **环境变量管理**：项目根目录 `.env`（本地开发），服务器通过 systemd 环境变量注入，禁止将 `.env` 提交 Git。

3. **LocalStorage 草稿 Schema 版本**：草稿 JSON 需包含 `schemaVersion` 字段，当 App 升级数据结构时，旧草稿版本不匹配则静默丢弃（而非崩溃）。

4. **Nginx 媒体缓存配置**：
   ```nginx
   location /media/ {
     root /var/www;
     expires 30d;
     add_header Cache-Control "public, immutable";
     add_header Vary Accept-Encoding;
   }
   ```

5. **组间计时器时间戳精度**：使用 `Date.now()` 毫秒级时间戳存储，展示时换算为秒（取整）。

---

*文档版本 v4.0.0 | 最后更新 2026-05-31*
