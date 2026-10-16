# ==========================================
# FitLog Backend - Multi-stage Production Dockerfile
# ==========================================

# --- Stage 1: Build & Dependencies ---
FROM node:20-alpine AS builder

WORKDIR /app

# 安装必要的构建工具与 OpenSSL（Prisma 依赖）
RUN apk add --no-cache openssl libc6-compat

COPY package*.json ./
COPY prisma ./prisma/

# 安装依赖并生成 Prisma Client
RUN npm ci
RUN npx prisma generate

# 复制服务端全部源代码
COPY src ./src/

# --- Stage 2: Production Runtime ---
FROM node:20-alpine AS runner

WORKDIR /app

# 生产环境安全标识
ENV NODE_ENV=production
ENV PORT=3001

# 安装 OpenSSL 与 curl（用于健康检查）
RUN apk add --no-cache openssl curl

# 创建并复制运行依赖
COPY package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/src ./src

# 设置 non-root 运行用户
RUN chown -R node:node /app
USER node

EXPOSE 3001

# 集成 Docker 原生探针
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3001/health/live || exit 1

CMD ["node", "src/index.js"]
