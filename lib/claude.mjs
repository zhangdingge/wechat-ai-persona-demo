import { query } from "@anthropic-ai/claude-agent-sdk";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import Debug from "debug";

const debug = Debug("cc-weixin:claude");

/** 项目根目录，包含本地生成的 CLAUDE.md */
const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKSPACE = join(__dirname, "..");
mkdirSync(WORKSPACE, { recursive: true });

/** 会话持久化文件 */
const SESSIONS_FILE = join(WORKSPACE, "sessions.json");

/**
 * 每个微信用户 × 每个模型各维护一条会话（key: `${userId}@@${model}`）。
 * 必须按模型隔离：视觉会话历史含图片块，续接进纯文本模型会触发模型错误。
 */
const SESSION_KEY_SEP = "@@";
const userSessions = new Map();
if (existsSync(SESSIONS_FILE)) {
  try {
    const data = JSON.parse(readFileSync(SESSIONS_FILE, "utf8"));
    for (const [k, v] of Object.entries(data)) {
      // 兼容旧格式：裸 userId 键视为纯文本模型会话
      const key = k.includes(SESSION_KEY_SEP) ? k : `${k}${SESSION_KEY_SEP}${process.env.ANTHROPIC_MODEL || "mimo-v2.5-pro"}`;
      userSessions.set(key, v);
    }
    console.log(`📋 已加载 ${userSessions.size} 个用户会话`);
  } catch (e) {
    console.error("⚠️ 会话文件损坏，忽略:", e.message);
  }
}

function saveSessions() {
  const obj = Object.fromEntries(userSessions);
  writeFileSync(SESSIONS_FILE, JSON.stringify(obj, null, 2), "utf8");
}

/**
 * 调用 Claude Code agent，返回最终文本回复
 * @param {string | object} content - 消息内容，字符串或 { text, images } 对象
 * @param {string} userId - 用户 ID
 */
// 纯文本默认模型；图片等多模态消息需切换到支持视觉的模型
// （MiMo 平台: mimo-v2.5-pro 仅文本，mimo-v2.5 为全模态）
const TEXT_MODEL = process.env.ANTHROPIC_MODEL || "mimo-v2.5-pro";
const VISION_MODEL = process.env.ANTHROPIC_MODEL_VISION || "mimo-v2.5";

export async function askClaude(content, userId) {
  // 依据内容选择模型：含图片走全模态模型，纯文字走旗舰文本模型
  const hasImages = content
    && typeof content === "object"
    && Array.isArray(content.images)
    && content.images.length > 0;
  const model = hasImages ? VISION_MODEL : TEXT_MODEL;
  const sessionKey = userId ? `${userId}${SESSION_KEY_SEP}${model}` : undefined;
  const existingSessionId = sessionKey ? userSessions.get(sessionKey) : undefined;
  debug("askClaude called: userId=%s, model=%s, hasSession=%s, sessionId=%s", userId, model, !!existingSessionId, existingSessionId);

  const options = {
    model,
    baseTools: [{ preset: "default" }],
    deniedTools: ["AskUserQuestion"],
    cwd: WORKSPACE,
    env: process.env,
    abortController: new AbortController(),
    skills: 'all',
    settingSources: ['user', 'project'],
  };

  debug("session_id for prompt: %s", existingSessionId || "(new)");

  if (existingSessionId) {
    options.resume = existingSessionId;
    debug("resuming session: %s", existingSessionId);
  }

  // 处理多模态内容
  let userMessageContent;
  if (typeof content === "string") {
    userMessageContent = content;
  } else if (content.images && content.images.length > 0) {
    // 有图片：构造 content 数组，包含文本和图片块
    userMessageContent = [];

    // 先加文本
    if (content.text) {
      userMessageContent.push({
        type: "text",
        text: content.text,
      });
    }

    // 再加图片
    for (const img of content.images) {
      const base64Data = img.buffer.toString("base64");
      userMessageContent.push({
        type: "image",
        source: {
          type: "base64",
          media_type: img.mimeType || "image/jpeg",
          data: base64Data,
        },
      });
    }

    // 如果没有文本，加个默认提示
    if (userMessageContent.length === content.images.length) {
      userMessageContent.unshift({
        type: "text",
        text: "请查看这张图片",
      });
    }

    debug("multimodal message: %d images, text=%s", content.images.length, content.text || "none");
  } else {
    userMessageContent = content.text || content;
  }

  // 始终使用 generator 格式，通过 session_id 管理会话续接
  const buildPrompt = (sid) => (async function* () {
    yield {
      type: "user",
      session_id: sid || "",
      parent_tool_use_id: null,
      message: { role: "user", content: userMessageContent },
    };
  })();

  /**
   * 判断错误是否可以通过"丢弃旧会话、新建会话"自愈：
   *  - 会话已失效：本地记录缺失 / 服务端会话过期
   *  - 模型拒绝：旧会话历史里残留当前模型不支持的内容（如纯文本模型历史中有图片块）
   */
  function isRecoverableError(err) {
    const msg = String(err?.message || err || "");
    return /No conversation (found )?for/i.test(msg)
      || /session[_ ]?(id )?(not found|does not exist|invalid|expired)/i.test(msg)
      || /could not resume|resume.*failed|无法.*恢复|会话.*(不存在|已失效|已过期)/i.test(msg)
      || /issue with the selected model|model.*(may not exist|no access|not have access)|selected model/i.test(msg);
  }

  /** 识别 SDK 以 result 文本形式返回的错误结果 */
  function isErrorResultText(text) {
    return /^Claude Code returned an error result:/i.test(String(text || ""));
  }

  /** 执行一次查询，返回回复文本；错误结果会抛异常以便上层重试 */
  async function runQuery(resumeId) {
    const opts = { ...options };
    if (resumeId) {
      opts.resume = resumeId;
    } else {
      delete opts.resume;
    }

    let text = "";
    let newSessionId = "";
    for await (const msg of query({ prompt: buildPrompt(resumeId), options: opts })) {
      debug("msg type=%s subtype=%s session_id=%s", msg.type, msg.subtype, msg.session_id);
      if (msg.type === "result") {
        text = msg.result ?? "";
        newSessionId = msg.session_id || "";
        if (msg.is_error || isErrorResultText(text)) {
          throw new Error(text);
        }
      }
    }
    return { text, newSessionId };
  }

  let result;
  let newSessionId;
  try {
    ({ text: result, newSessionId } = await runQuery(existingSessionId));
  } catch (err) {
    // 续接会话出错且可自愈 → 丢弃旧 ID，用全新会话重试一次（只重试一次）
    if (!existingSessionId || !isRecoverableError(err)) throw err;
    debug("recoverable error on session %s, retrying as new session: %s", existingSessionId, String(err.message).slice(0, 120));
    console.warn(`⚠️  旧会话异常，自动新建会话重试（原 ID: ${existingSessionId.slice(0, 8)}…）`);
    if (sessionKey) {
      userSessions.delete(sessionKey);
      saveSessions();
    }
    ({ text: result, newSessionId } = await runQuery(undefined));
  }

  if (sessionKey && newSessionId) {
    userSessions.set(sessionKey, newSessionId);
    saveSessions();
    debug("stored session: %s -> sessionId=%s", sessionKey, newSessionId);
  }
  debug("result length=%d", result.length);
  return result || "（Claude 无回复）";
}
