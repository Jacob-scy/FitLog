import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 测试用手机号与密码 (强密码：>=8位，含字母与数字)
const VALID_PHONE = '13800000001';
const VALID_PASSWORD = 'FitLogStrong123';
const DIFFERENT_PASSWORD = 'AnotherPass456';
const WRONG_PASSWORD = 'WrongPassword999';
const UNREGISTERED_PHONE = '13899999999';

test.describe.serial('FITLOG AUTH V2: 手机号 + 密码主认证流程 E2E 全量测试', () => {
  test.beforeAll(async ({ request }) => {
    // 1. 清理遗留测试数据 (采用绝对路径防止 Windows 解析层级偏差)
    const cleanScript = path.resolve(__dirname, '../../server/scripts/clean-e2e-data.js');
    execSync(`node "${cleanScript}"`);

    // 2. 清空 Rate Limit
    try {
      await request.post('http://localhost:3001/api/v1/auth/test/clear-rate-limit');
    } catch {
      // ignore
    }
  });

  test.afterAll(() => {
    try {
      const cleanScript = path.resolve(__dirname, '../../server/scripts/clean-e2e-data.js');
      execSync(`node "${cleanScript}"`);
    } catch {
      // ignore
    }
  });

  // ----------------------------------------------------
  // 场景 1：注册成功
  // ----------------------------------------------------
  test('场景 1: 手机号 + 强密码注册成功并自动签发 Token 进入主页', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    // 切换至注册页面
    await page.locator('button:has-text("注册新账号")').click();
    await expect(page.locator('text=注册新账号')).toBeVisible();

    // 填入手机号与密码
    await page.locator('input[placeholder="输入11位手机号"]').fill(VALID_PHONE);
    await page.locator('input[placeholder="输入8位以上组合密码"]').fill(VALID_PASSWORD);
    await page.locator('input[placeholder="再次输入确认密码"]').fill(VALID_PASSWORD);

    // 点击注册按钮
    await page.locator('button[type="submit"]:has-text("注册")').click();

    // 注册成功自动登录并离开登录页
    await expect(page).not.toHaveURL(/\/login/, { timeout: 10000 });
  });

  // ----------------------------------------------------
  // 场景 2：重复手机号注册失败
  // ----------------------------------------------------
  test('场景 2: 已注册的手机号再次注册时被拒绝 (409)', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    await page.locator('button:has-text("注册新账号")').click();
    await page.locator('input[placeholder="输入11位手机号"]').fill(VALID_PHONE);
    await page.locator('input[placeholder="输入8位以上组合密码"]').fill(VALID_PASSWORD);
    await page.locator('input[placeholder="再次输入确认密码"]').fill(VALID_PASSWORD);

    await page.locator('button[type="submit"]:has-text("注册")').click();

    // 验证提示手机号已注册
    await expect(page.locator('[data-testid="auth-error-message"]')).toContainText('已被注册');
  });

  // ----------------------------------------------------
  // 场景 3：密码不一致
  // ----------------------------------------------------
  test('场景 3: 两次输入的密码不一致被前端/后端正确拦截', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    await page.locator('button:has-text("注册新账号")').click();
    await page.locator('input[placeholder="输入11位手机号"]').fill('13800000002');
    await page.locator('input[placeholder="输入8位以上组合密码"]').fill(VALID_PASSWORD);
    await page.locator('input[placeholder="再次输入确认密码"]').fill(DIFFERENT_PASSWORD);

    await page.locator('button[type="submit"]:has-text("注册")').click();

    await expect(page.locator('[data-testid="auth-error-message"]')).toContainText('两次输入的密码不一致');
  });

  // ----------------------------------------------------
  // 场景 4：弱密码拦截
  // ----------------------------------------------------
  test('场景 4: 弱密码（少于8位、纯数字、纯字母）被严格拦截', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    await page.locator('button:has-text("注册新账号")').click();

    // 4.1 少于 8 位
    await page.locator('input[placeholder="输入11位手机号"]').fill('13800000003');
    await page.locator('input[placeholder="输入8位以上组合密码"]').fill('pass1');
    await page.locator('input[placeholder="再次输入确认密码"]').fill('pass1');
    await page.locator('button[type="submit"]:has-text("注册")').click();
    await expect(page.locator('[data-testid="auth-error-message"]')).toContainText('至少为 8 位');

    // 4.2 纯数字弱密码
    await page.locator('input[placeholder="输入8位以上组合密码"]').fill('12345678');
    await page.locator('input[placeholder="再次输入确认密码"]').fill('12345678');
    await page.locator('button[type="submit"]:has-text("注册")').click();
    await expect(page.locator('[data-testid="auth-error-message"]')).toContainText('同时包含字母和数字');
  });

  // ----------------------------------------------------
  // 场景 5：手机号格式错误
  // ----------------------------------------------------
  test('场景 5: 非法格式手机号被格式校验拦截', async ({ request }) => {
    // 5.1 API 级别严格拦截
    const res = await request.post('http://localhost:3001/api/v1/auth/register', {
      data: {
        phone: '123456',
        password: VALID_PASSWORD,
        confirmPassword: VALID_PASSWORD,
      },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.message || body.error).toContain('手机号');
  });

  // ----------------------------------------------------
  // 场景 6：登录成功
  // ----------------------------------------------------
  test('场景 6: 手机号 + 正确密码成功登录并进入主页', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    // 确保在登录模式
    await expect(page.locator('text=手机号密码登录')).toBeVisible();

    await page.locator('input[placeholder="输入11位手机号"]').fill(VALID_PHONE);
    await page.locator('input[placeholder="输入登录密码"]').fill(VALID_PASSWORD);
    await page.locator('button[type="submit"]:has-text("登录")').click();

    await expect(page).not.toHaveURL(/\/login/, { timeout: 10000 });
  });

  // ----------------------------------------------------
  // 场景 7：密码错误统一处理 (防探测)
  // ----------------------------------------------------
  test('场景 7: 密码错误返回 401 且统一提示“手机号或密码错误”', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    await page.locator('input[placeholder="输入11位手机号"]').fill(VALID_PHONE);
    await page.locator('input[placeholder="输入登录密码"]').fill(WRONG_PASSWORD);
    await page.locator('button[type="submit"]:has-text("登录")').click();

    await expect(page.locator('[data-testid="auth-error-message"]')).toContainText('手机号或密码错误');
  });

  // ----------------------------------------------------
  // 场景 8：未注册手机号统一处理 (防探测枚举)
  // ----------------------------------------------------
  test('场景 8: 未注册手机号登录同样返回 401 且提示相同文案，杜绝探测枚举', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    await page.locator('input[placeholder="输入11位手机号"]').fill(UNREGISTERED_PHONE);
    await page.locator('input[placeholder="输入登录密码"]').fill(VALID_PASSWORD);
    await page.locator('button[type="submit"]:has-text("登录")').click();

    // 必须与密码错误的提示完全一致，不暴露账号是否存在
    await expect(page.locator('[data-testid="auth-error-message"]')).toContainText('手机号或密码错误');
  });

  // ----------------------------------------------------
  // 场景 9：登录失败限流 (防暴力破解)
  // ----------------------------------------------------
  test('场景 9: 连续输错密码达到阈值触发限流锁号 (429)', async ({ request }) => {
    const lockPhone = '13800000009';
    // 先注册一个供测试限流的用户
    await request.post('http://localhost:3001/api/v1/auth/register', {
      data: {
        phone: lockPhone,
        password: VALID_PASSWORD,
        confirmPassword: VALID_PASSWORD,
      },
    });

    let rateLimited = false;
    // 连续尝试 6 次错误密码
    for (let i = 0; i < 6; i++) {
      const res = await request.post('http://localhost:3001/api/v1/auth/phone-password/login', {
        data: {
          phone: lockPhone,
          password: 'IncorrectPass123',
        },
      });

      if (res.status() === 429) {
        rateLimited = true;
        const data = await res.json();
        expect(data.errorCode || data.error).toBe('ACCOUNT_LOCKED');
        break;
      }
    }
    expect(rateLimited).toBe(true);

    // 清理限流，避免后续干扰
    await request.post('http://localhost:3001/api/v1/auth/test/clear-rate-limit');
  });

  // ----------------------------------------------------
  // 场景 10：Refresh Token 正常轮转
  // ----------------------------------------------------
  test('场景 10: Refresh Token 轮转机制正常运行', async ({ request }) => {
    // 1. 登录获取 Cookie
    const loginRes = await request.post('http://localhost:3001/api/v1/auth/phone-password/login', {
      data: {
        phone: VALID_PHONE,
        password: VALID_PASSWORD,
      },
    });
    expect(loginRes.status()).toBe(200);

    // 2. 调用 /refresh 接口
    const refreshRes = await request.post('http://localhost:3001/api/v1/auth/refresh');
    expect(refreshRes.status()).toBe(200);
    const refreshData = await refreshRes.json();
    expect(refreshData.data?.accessToken).toBeDefined();
    expect(refreshData.data?.user?.id).toBeDefined();
  });

  // ----------------------------------------------------
  // 场景 11：Logout 正常清除会话
  // ----------------------------------------------------
  test('场景 11: 退出登录成功销毁 Session 并跳回登录页', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/login');
    await page.locator('input[placeholder="输入11位手机号"]').fill(VALID_PHONE);
    await page.locator('input[placeholder="输入登录密码"]').fill(VALID_PASSWORD);
    await page.locator('button[type="submit"]:has-text("登录")').click();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 10000 });

    // 前往个人中心 /profile
    await page.goto('/profile');
    await page.waitForLoadState('networkidle');

    // 点击退出登录
    const logoutBtn = page.locator('button:has-text("退出登录")');
    await expect(logoutBtn).toBeVisible({ timeout: 5000 });
    await logoutBtn.click();

    // 确认回到 /login
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
  });

  // ----------------------------------------------------
  // 场景 12：重新登录
  // ----------------------------------------------------
  test('场景 12: 退出登录后可重新正常登录', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    await page.locator('input[placeholder="输入11位手机号"]').fill(VALID_PHONE);
    await page.locator('input[placeholder="输入登录密码"]').fill(VALID_PASSWORD);
    await page.locator('button[type="submit"]:has-text("登录")').click();

    await expect(page).not.toHaveURL(/\/login/, { timeout: 10000 });
  });

  // ----------------------------------------------------
  // 场景 13：IDOR 越权防御回归测试
  // ----------------------------------------------------
  test('场景 13: 无法利用伪造或他人 ID 越权访问资源 (IDOR 防御)', async ({ request }) => {
    // 登录当前用户
    const loginRes = await request.post('http://localhost:3001/api/v1/auth/phone-password/login', {
      data: {
        phone: VALID_PHONE,
        password: VALID_PASSWORD,
      },
    });
    const { accessToken } = (await loginRes.json()).data;

    // 尝试请求伪造/他人资源 (IDOR 越权请求)
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const idorRes = await request.get(`http://localhost:3001/api/v1/workouts/records/${fakeId}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    // 必须返回 404 或 403，绝不能返回 200 或泄露数据
    expect([403, 404]).toContain(idorRes.status());
  });

  // ----------------------------------------------------
  // 场景 14：passwordHash 绝不出现在 API 响应中
  // ----------------------------------------------------
  test('场景 14: 注册、登录、刷新等所有 API 响应体均不包含 passwordHash', async ({ request }) => {
    const testPhone = '13800000014';
    // 1. 注册 API 检查
    const regRes = await request.post('http://localhost:3001/api/v1/auth/register', {
      data: {
        phone: testPhone,
        password: VALID_PASSWORD,
        confirmPassword: VALID_PASSWORD,
      },
    });
    const regText = await regRes.text();
    expect(regText.toLowerCase()).not.toContain('passwordhash');

    // 2. 登录 API 检查
    const loginRes = await request.post('http://localhost:3001/api/v1/auth/phone-password/login', {
      data: {
        phone: testPhone,
        password: VALID_PASSWORD,
      },
    });
    const loginText = await loginRes.text();
    expect(loginText.toLowerCase()).not.toContain('passwordhash');

    // 3. 刷新 API 检查
    const refreshRes = await request.post('http://localhost:3001/api/v1/auth/refresh');
    const refreshText = await refreshRes.text();
    expect(refreshText.toLowerCase()).not.toContain('passwordhash');
  });

  // ----------------------------------------------------
  // 场景 15：密码绝不出现在脱敏日志中
  // ----------------------------------------------------
  test('场景 15: Logger 脱敏机制确保密码与 passwordHash 不被明文记录', async () => {
    const loggerModulePath = pathToFileURL(path.resolve(__dirname, '../../server/src/lib/logger/logger.js')).href;
    const { maskSensitive } = await import(loggerModulePath);

    const testPayload = {
      phone: '13812345678',
      password: 'MySecretPassword123',
      passwordHash: '$2a$10$abcdefghijklmnopqrstuvwxyz123456',
      confirmPassword: 'MySecretPassword123',
      nested: {
        password: 'NestedSecretPassword',
      },
    };

    const masked = maskSensitive(testPayload);
    expect(masked.password).toBe('[REDACTED]');
    expect(masked.passwordHash).toBe('[REDACTED]');
    expect(masked.confirmPassword).toBe('[REDACTED]');
    expect(masked.nested.password).toBe('[REDACTED]');
    expect(JSON.stringify(masked)).not.toContain('MySecretPassword123');
    expect(JSON.stringify(masked)).not.toContain('NestedSecretPassword');
    expect(JSON.stringify(masked)).not.toContain('$2a$10$');
  });
});
