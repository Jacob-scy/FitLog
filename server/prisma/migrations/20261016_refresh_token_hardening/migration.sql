-- Refresh Token 哈希存储 + 轮换事务化 + 重放检测
-- 对应 schema.prisma RefreshToken:28
-- 新增 rotatedAt：记录首次轮换时刻，用于宽限期复用判定与重放检测
-- 注意：MySQL 不支持 ADD COLUMN IF NOT EXISTS，本迁移重复执行会报 duplicate column，
--      执行前请确认列不存在（沿用 20261015_add_favorites_templates 的先例，不做条件封装）

ALTER TABLE `RefreshToken` ADD COLUMN `rotatedAt` DATETIME(3) NULL;
