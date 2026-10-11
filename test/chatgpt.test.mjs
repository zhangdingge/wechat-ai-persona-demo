import test from 'node:test';
import assert from 'node:assert/strict';
import { appendDeliveredExchange, appendProactiveAssistant, parseResponseEvent } from '../lib/chatgpt.mjs';

test('普通回复只在明确提交时追加一轮，保留图片标记及此前的主动消息', () => {
  const original = { alice: [{ role: 'assistant', content: '刚发的主动消息' }] };
  const input = { text: '看看', images: [{ buffer: Buffer.from('image'), mimeType: 'image/jpeg' }] };
  const committed = appendDeliveredExchange(original, 'alice', input, '看到了');
  assert.deepEqual(original.alice, [{ role: 'assistant', content: '刚发的主动消息' }]);
  assert.deepEqual(committed.alice, [
    { role: 'assistant', content: '刚发的主动消息' },
    { role: 'user', content: '看看\n[附带 1 张图片]' },
    { role: 'assistant', content: '看到了' },
  ]);
  assert.equal(appendDeliveredExchange(original, null, input, 'CLI 测试'), original);
});

test('主动消息进入助手历史，不会伪装成用户输入', () => {
  const original = { alice: [{ role: 'user', content: '你好' }] };
  const result = appendProactiveAssistant(original, 'alice', '晚上好');
  assert.deepEqual(result.alice, [
    { role: 'user', content: '你好' },
    { role: 'assistant', content: '晚上好' },
  ]);
  assert.deepEqual(original.alice, [{ role: 'user', content: '你好' }]);
});

test('只有收到 response.completed 才能认定流式回复完成', () => {
  const state = { text: '', completed: false };
  parseResponseEvent({ type: 'response.output_text.delta', delta: '连接' }, state);
  assert.equal(state.completed, false);
  parseResponseEvent({ type: 'response.output_text.delta', delta: '成功' }, state);
  parseResponseEvent({ type: 'response.completed' }, state);
  assert.deepEqual(state, { text: '连接成功', completed: true });
  assert.throws(() => parseResponseEvent({ type: 'response.failed', response: { error: { code: 'subscription_sharing_usage_limit_exceeded' } } }, state), /usage_limit/);
});
