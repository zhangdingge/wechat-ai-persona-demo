import { existsSync, readFileSync, writeFileSync, renameSync, chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { accessToken } from './chatgpt-auth.mjs';

const HISTORY_FILE = fileURLToPath(new URL('../chatgpt-history.json', import.meta.url));
const PERSONA_FILE = fileURLToPath(new URL('../CLAUDE.md', import.meta.url));
const API = 'https://api.openai.com/v1';
const MAX_MESSAGES = 20;
const MODELS_TIMEOUT_MS = 30_000;
const RESPONSE_TIMEOUT_MS = 180_000;
let modelCache;

function loadHistory() {
  if (!existsSync(HISTORY_FILE)) return {};
  return JSON.parse(readFileSync(HISTORY_FILE, 'utf8'));
}

function saveHistory(data) {
  const temp = `${HISTORY_FILE}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(data, null, 2), { mode: 0o600 });
  chmodSync(temp, 0o600);
  renameSync(temp, HISTORY_FILE);
  chmodSync(HISTORY_FILE, 0o600);
}

async function authorizedFetch(path, options = {}) {
  const send = token => fetch(`${API}${path}`, {
    ...options,
    headers: { ...options.headers, Authorization: `Bearer ${token}` },
  });
  let response = await send(await accessToken());
  if (response.status === 401) response = await send(await accessToken({ forceRefresh: true }));
  return response;
}

// Keep the same deadline through fetch, response body, and the streaming reply.
async function withTimeout(timeoutMs, operation) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await operation(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`ChatGPT 请求超过 ${Math.round(timeoutMs / 1000)} 秒，已中止`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function listModels() {
  if (modelCache && Date.now() - modelCache.at < 15 * 60_000) return modelCache.models;
  const body = await withTimeout(MODELS_TIMEOUT_MS, async signal => {
    const response = await authorizedFetch('/models', { signal });
    if (!response.ok) throw new Error(`无法获取 ChatGPT 可用模型：HTTP ${response.status}`);
    return response.json();
  });
  const models = (body.models ?? []).filter(item => item.visibility === 'list' && item.slug);
  if (!models.length) throw new Error('当前 ChatGPT 账号没有可用的套餐模型');
  modelCache = { at: Date.now(), models };
  return models;
}

async function selectedModel() {
  const models = await listModels();
  const selected = process.env.CHATGPT_MODEL;
  if (selected) {
    if (!models.some(model => model.slug === selected)) throw new Error(`CHATGPT_MODEL=${selected} 不在此账号的可用模型列表中`);
    return selected;
  }
  return models[0].slug;
}

function normalizedText(content) {
  return typeof content === 'string' ? content : content?.text ?? '';
}

function currentMessage(content) {
  const blocks = [{ type: 'input_text', text: normalizedText(content) || '请看这张图片。' }];
  for (const image of content?.images ?? []) {
    const mimeType = image.mimeType || 'image/jpeg';
    blocks.push({ type: 'input_image', image_url: `data:${mimeType};base64,${image.buffer.toString('base64')}` });
  }
  return { role: 'user', content: blocks };
}

export function parseResponseEvent(event, state) {
  if (event.type === 'response.output_text.delta') state.text += event.delta ?? '';
  if (event.type === 'response.failed') throw new Error(`ChatGPT 请求失败：${event.response?.error?.code ?? 'unknown_error'}`);
  if (event.type === 'response.incomplete') throw new Error('ChatGPT 回复未完成');
  if (event.type === 'response.completed') {
    state.completed = true;
    if (!state.text) state.text = (event.response?.output ?? [])
      .flatMap(item => item.content ?? [])
      .filter(item => item.type === 'output_text')
      .map(item => item.text ?? '').join('');
  }
}

async function readStream(response) {
  if (!response.ok) {
    let code = '';
    try { code = (await response.json()).error?.code ?? ''; } catch {}
    throw new Error(`ChatGPT 请求失败：HTTP ${response.status}${code ? ` (${code})` : ''}`);
  }
  const state = { text: '', completed: false };
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    buffer = buffer.replace(/\r\n/g, '\n');
    let boundary;
    while ((boundary = buffer.indexOf('\n\n')) !== -1) {
      const packet = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = packet.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
      if (!data || data === '[DONE]') continue;
      parseResponseEvent(JSON.parse(data), state);
    }
  }
  if (!state.completed) throw new Error('ChatGPT 回复流中断，未收到 response.completed');
  if (!state.text.trim()) throw new Error('ChatGPT 返回了空回复');
  return state.text;
}

export async function askChatGPT(content, userId) {
  const history = loadHistory();
  const past = userId ? history[userId] ?? [] : [];
  const input = [
    ...past.map(message => ({ role: message.role, content: message.content })),
    currentMessage(content),
  ];
  const instructions = existsSync(PERSONA_FILE) ? readFileSync(PERSONA_FILE, 'utf8') : '';
  const model = await selectedModel();
  return withTimeout(RESPONSE_TIMEOUT_MS, async signal => {
    const response = await authorizedFetch('/responses', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
      body: JSON.stringify({ model, input, instructions, store: false, stream: true }),
    });
    return readStream(response);
  });
}

// Call only after every part of the normal reply has been sent successfully.
export function appendDeliveredExchange(history, userId, content, reply) {
  if (!userId || !reply?.trim()) return history;
  const userText = normalizedText(content) + ((content?.images?.length ?? 0) ? `\n[附带 ${content.images.length} 张图片]` : '');
  return { ...history, [userId]: [
    ...(history[userId] ?? []),
    { role: 'user', content: userText },
    { role: 'assistant', content: reply },
  ].slice(-MAX_MESSAGES) };
}

export function rememberDeliveredExchange(userId, content, reply) {
  if (!userId || !reply?.trim()) return;
  // Reload at commit time so a successful proactive send is not overwritten.
  saveHistory(appendDeliveredExchange(loadHistory(), userId, content, reply));
}

// 主动发送的文字属于机器人，不应被记成用户发来的话。
export function appendProactiveAssistant(history, userId, text) {
  if (!userId || !text?.trim()) return history;
  return { ...history, [userId]: [...(history[userId] ?? []), { role: 'assistant', content: text.trim() }].slice(-MAX_MESSAGES) };
}

export function rememberProactiveMessage(userId, text) {
  if (!userId || !text?.trim()) return;
  saveHistory(appendProactiveAssistant(loadHistory(), userId, text));
}
