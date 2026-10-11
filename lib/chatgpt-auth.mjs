import { createHash, createPublicKey, randomBytes, randomUUID, timingSafeEqual, verify } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, renameSync, chmodSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FILE = fileURLToPath(new URL('../.chatgpt-auth.json', import.meta.url));
const ISSUER = 'https://auth.openai.com';
const RESOURCE = 'https://api.openai.com/v1';
const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const AUTH_URL = `${ISSUER}/api/accounts/authorize`;
const TOKEN_URL = `${ISSUER}/api/accounts/oauth/token`;
const JWKS_URL = `${ISSUER}/.well-known/jwks.json`;
const CALLBACK_PATH = '/auth/callback';
const AUTH_REQUEST_TIMEOUT_MS = 30_000;
let refreshInFlight;

function save(data) {
  const temp = `${FILE}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(data, null, 2), { mode: 0o600 });
  chmodSync(temp, 0o600);
  renameSync(temp, FILE);
  chmodSync(FILE, 0o600);
}

export function loadAuth() {
  if (!existsSync(FILE)) return null;
  return JSON.parse(readFileSync(FILE, 'utf8'));
}

function safeEqual(a, b) {
  const left = Buffer.from(a ?? '');
  const right = Buffer.from(b ?? '');
  return left.length === right.length && timingSafeEqual(left, right);
}

async function readJson(response, label) {
  if (!response.ok) {
    let code = '';
    try { code = (await response.json()).error ?? ''; } catch {}
    throw new Error(`${label}失败：HTTP ${response.status}${code ? ` (${code})` : ''}`);
  }
  return response.json();
}

async function fetchJson(url, options, label) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AUTH_REQUEST_TIMEOUT_MS);
  try {
    return await readJson(await fetch(url, { ...options, signal: controller.signal }), label);
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`${label}超时，请重试`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function verifyIdToken(token, clientId, nonce) {
  const segments = token?.split('.');
  if (segments?.length !== 3) throw new Error('登录返回的身份令牌无效');
  const header = JSON.parse(Buffer.from(segments[0], 'base64url').toString());
  const payload = JSON.parse(Buffer.from(segments[1], 'base64url').toString());
  if (!['RS256', 'ES256'].includes(header.alg) || !header.kid) throw new Error('身份令牌签名格式不受支持');
  const keys = await fetchJson(JWKS_URL, {}, '读取 OpenAI 公钥');
  const jwk = keys.keys?.find(key => key.kid === header.kid && (!key.alg || key.alg === header.alg) && (!key.use || key.use === 'sig'));
  if (!jwk) throw new Error('找不到身份令牌对应的 OpenAI 公钥');
  const signature = Buffer.from(segments[2], 'base64url');
  const options = header.alg === 'ES256' ? { key: createPublicKey({ key: jwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' } : createPublicKey({ key: jwk, format: 'jwk' });
  if (!verify('sha256', Buffer.from(`${segments[0]}.${segments[1]}`), options, signature)) throw new Error('身份令牌签名验证失败');
  const now = Date.now() / 1000;
  const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (payload.iss !== ISSUER || !audience.includes(clientId) || typeof payload.exp !== 'number' || payload.exp < now - 5 || typeof payload.iat !== 'number' || payload.iat > now + 5 || !payload.sub || !safeEqual(payload.nonce, nonce)) {
    throw new Error('身份令牌的签发方、受众、时效或 nonce 验证失败');
  }
  return payload;
}

function openBrowser(url) {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'darwin' ? ['-a', 'Safari', url] : process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  const child = spawn(command, args, { stdio: 'ignore' });
  child.on('error', () => console.error(`无法自动打开浏览器，请将以下一次性链接复制到 Safari：\n${url}`));
  child.on('close', code => { if (code !== 0) console.error(`浏览器未能自动打开，请将以下一次性链接复制到 Safari：\n${url}`); });
}

export async function signIn() {
  const previous = loadAuth();
  const hostId = previous?.hostId ?? `urn:uuid:${randomUUID()}`;
  if (!previous) save({ hostId });
  const state = randomBytes(32).toString('base64url');
  const nonce = randomBytes(32).toString('base64url');
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  let complete;
  let fail;
  const callback = new Promise((resolve, reject) => { complete = resolve; fail = reject; });
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname !== CALLBACK_PATH) { response.writeHead(404).end(); return; }
    if (!safeEqual(url.searchParams.get('state'), state)) {
      response.writeHead(400).end('授权状态不匹配，请关闭页面重试。');
      fail(new Error('授权状态不匹配'));
      return;
    }
    if (url.searchParams.has('error')) {
      response.writeHead(400).end('授权已取消或未获得权限。');
      fail(new Error(`授权未完成：${url.searchParams.get('error')}`));
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end('授权已返回，请回到终端查看结果。');
    complete({ code: url.searchParams.get('code'), clientId: url.searchParams.get('client_id') });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const redirectUri = `http://127.0.0.1:${server.address().port}${CALLBACK_PATH}`;
  const params = new URLSearchParams({
    client_id: previous?.clientId ?? 'dynamic_agent_client',
    ext_agent_host_id: hostId,
    response_type: 'code', redirect_uri: redirectUri, scope: SCOPES,
    resource: RESOURCE, state, nonce, code_challenge_method: 'S256', code_challenge: challenge,
  });
  // 总是经账户选择器登录，避免在可能要手动复制的链接中携带 id_token_hint。
  if (!previous?.clientId) {
    params.set('agent_name_hint', 'WeChat AI Role Demo');
  }
  const authorizationUrl = `${AUTH_URL}?${params}`;
  if (process.env.CHATGPT_MANUAL_BROWSER === '1') {
    console.log('请把以下一次性授权链接复制到 Safari 打开（10 分钟内完成）：');
    console.log(authorizationUrl);
  } else {
    console.log('正在系统浏览器中打开 ChatGPT 授权页面；请在网页中完成登录和授权。');
    openBrowser(authorizationUrl);
  }
  const timeout = setTimeout(() => fail(new Error('等待浏览器授权超时')), 10 * 60_000);
  try {
    const result = await callback;
    if (!result.code) throw new Error('授权回调缺少 code');
    const clientId = previous?.clientId ?? result.clientId;
    if (!clientId || clientId === 'dynamic_agent_client' || (previous?.clientId && result.clientId && result.clientId !== previous.clientId)) throw new Error('授权回调 client_id 不匹配');
    const tokens = await fetchJson(TOKEN_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code: result.code, code_verifier: verifier, redirect_uri: redirectUri, resource: RESOURCE }),
    }, '交换授权码');
    const identity = await verifyIdToken(tokens.id_token, clientId, nonce);
    if (previous?.subject && previous.subject !== identity.sub) throw new Error('登录的不是原先绑定的 ChatGPT 账号');
    const scopes = (tokens.scope ?? '').split(/\s+/).filter(Boolean);
    if (!scopes.includes('chatgpt.tokens.use.direct')) throw new Error('本次授权未获得 ChatGPT 套餐调用权限');
    if (!tokens.access_token || !tokens.refresh_token) throw new Error('授权返回的令牌不完整');
    const data = { hostId, clientId, subject: identity.sub, email: identity.email ?? null, idToken: tokens.id_token,
      accessToken: tokens.access_token, refreshToken: tokens.refresh_token, scopes,
      expiresAt: Date.now() + Number(tokens.expires_in ?? 3600) * 1000 };
    save(data);
    return { email: data.email, clientId: data.clientId };
  } finally {
    clearTimeout(timeout);
    server.close();
  }
}

async function refresh() {
  const data = loadAuth();
  if (!data?.refreshToken || !data.clientId) throw new Error('尚未完成 ChatGPT 授权，请先运行 npm run chatgpt:login');
  const tokens = await fetchJson(TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: data.clientId, refresh_token: data.refreshToken, resource: RESOURCE }),
  }, '刷新 ChatGPT 授权');
  const scopes = tokens.scope ? tokens.scope.split(/\s+/).filter(Boolean) : data.scopes;
  if (!scopes.includes('chatgpt.tokens.use.direct') || !tokens.access_token || !tokens.refresh_token) throw new Error('刷新后缺少 ChatGPT 套餐调用权限，请重新授权');
  save({ ...data, accessToken: tokens.access_token, refreshToken: tokens.refresh_token,
    idToken: tokens.id_token ?? data.idToken, scopes, expiresAt: Date.now() + Number(tokens.expires_in ?? 3600) * 1000 });
  return tokens.access_token;
}

export async function accessToken({ forceRefresh = false } = {}) {
  const data = loadAuth();
  if (!data?.accessToken || !data.scopes?.includes('chatgpt.tokens.use.direct')) throw new Error('尚未完成 ChatGPT 套餐授权，请先运行 npm run chatgpt:login');
  if (!forceRefresh && Date.now() < data.expiresAt - 60_000) return data.accessToken;
  if (!refreshInFlight) refreshInFlight = refresh().finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}
