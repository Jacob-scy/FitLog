/**
 * 测试替身：进程内内存版 Prisma 客户端
 *
 * 目的：让 auth 模块用例不依赖真实数据库与外网，可回归、可并行。
 * 仅实现 auth.service.js 实际用到的查询能力（findUnique / create / update /
 * deleteMany / $transaction）与 where 条件子集（等值、not、lt、OR）。
 * 注意：$transaction 在替身里只是顺序执行回调，不提供真实事务的原子性 ——
 * 事务语义由真实 Prisma 保证，替身仅用于验证调用路径与状态结果。
 */

function matchWhere(row, where = {}) {
  for (const [key, cond] of Object.entries(where)) {
    if (key === 'OR') {
      if (!cond.some((sub) => matchWhere(row, sub))) return false;
      continue;
    }
    if (cond && typeof cond === 'object') {
      if ('not' in cond) {
        if (row[key] === cond.not) return false;
        continue;
      }
      if ('lt' in cond) {
        if (!(row[key] != null && new Date(row[key]).getTime() < new Date(cond.lt).getTime())) return false;
        continue;
      }
      if ('gt' in cond) {
        if (!(row[key] != null && new Date(row[key]).getTime() > new Date(cond.gt).getTime())) return false;
        continue;
      }
      if (cond instanceof Date) {
        if (new Date(row[key]).getTime() !== cond.getTime()) return false;
        continue;
      }
    }
    if (row[key] !== cond) return false;
  }
  return true;
}

export function createFakePrisma() {
  const state = {
    User: [],
    RefreshToken: [],
    seq: 0,
  };

  const delegate = (model) => ({
    async findUnique({ where } = {}) {
      return state[model].find((row) => matchWhere(row, where)) ?? null;
    },
    async findFirst({ where } = {}) {
      return state[model].find((row) => matchWhere(row, where)) ?? null;
    },
    async findMany({ where } = {}) {
      return state[model].filter((row) => matchWhere(row, where ?? {}));
    },
    async create({ data }) {
      const row = { id: `${model.toLowerCase()}_${(state.seq += 1)}`, createdAt: new Date(), ...data };
      state[model].push(row);
      return row;
    },
    async update({ where, data }) {
      const row = state[model].find((r) => matchWhere(r, where));
      if (!row) {
        const err = new Error('Record not found');
        err.code = 'P2025';
        throw err;
      }
      Object.assign(row, data);
      return row;
    },
    async updateMany({ where, data }) {
      let count = 0;
      for (const row of state[model]) {
        if (matchWhere(row, where ?? {})) {
          Object.assign(row, data);
          count += 1;
        }
      }
      return { count };
    },
    async deleteMany({ where } = {}) {
      const keep = state[model].filter((row) => !matchWhere(row, where ?? {}));
      const count = state[model].length - keep.length;
      state[model] = keep;
      return { count };
    },
  });

  const client = {
    user: delegate('User'),
    refreshToken: delegate('RefreshToken'),
    async $transaction(fn) {
      return fn(client);
    },
    _state: state,
  };

  return client;
}

export const fakePrisma = createFakePrisma();

export function resetFakePrisma() {
  fakePrisma._state.User = [];
  fakePrisma._state.RefreshToken = [];
  fakePrisma._state.seq = 0;
}
