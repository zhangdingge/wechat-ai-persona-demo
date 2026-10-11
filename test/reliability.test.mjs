import test from 'node:test';
import assert from 'node:assert/strict';
import { apiPost } from '../lib/api.mjs';
import { sendMessage } from '../lib/messaging.mjs';
import { assertAllowedUserConfiguration, isAllowedUser, parseAllowedUserIds } from '../lib/allowed-users.mjs';

test('普通模式白名单按完整 ID 匹配，未设置则允许所有人', () => {
  const allowed = parseAllowedUserIds(' alice@im.wechat, bob@im.wechat ,,alice@im.wechat ');
  assert.deepEqual([...allowed], ['alice@im.wechat', 'bob@im.wechat']);
  assert.equal(isAllowedUser(allowed, 'alice@im.wechat'), true);
  assert.equal(isAllowedUser(allowed, 'alice'), false);
  assert.equal(isAllowedUser(allowed, 'other@im.wechat'), false);
  assert.equal(isAllowedUser(parseAllowedUserIds(undefined), 'other@im.wechat'), true);
  assert.throws(() => assertAllowedUserConfiguration(true, false, parseAllowedUserIds(undefined)), /WECHAT_ALLOWED_USER_IDS/);
  assert.doesNotThrow(() => assertAllowedUserConfiguration(true, true, parseAllowedUserIds(undefined)));
  assert.doesNotThrow(() => assertAllowedUserConfiguration(true, false, allowed));
});

test('微信发送超时不能被当作成功', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }); };
  try {
    await assert.rejects(sendMessage('https://example.invalid', 'token', 'alice', '你好', 'ctx'), /微信发送超时/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('微信发送接口返回错误码不能被当作成功', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, text: async () => JSON.stringify({ errcode: -14 }) });
  try {
    await assert.rejects(sendMessage('https://example.invalid', 'token', 'alice', '你好', 'ctx'), /errcode=-14/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('微信请求超时覆盖响应正文读取', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => ({
    ok: true,
    text: () => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
    }),
  });
  try {
    assert.equal(await apiPost('https://example.invalid', 'test', {}, 'token', 10), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
