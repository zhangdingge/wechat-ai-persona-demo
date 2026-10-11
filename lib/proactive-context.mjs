import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

const DEFAULT_TTL_MS = 8 * 60 * 60 * 1000;
const MAX_PARTS = 5;

/** 只记录机器人已经成功发出的主动消息，供该用户下一次正常回复使用。 */
export function createProactiveContextStore(filePath, { now = Date.now, ttlMs = DEFAULT_TTL_MS } = {}) {
  const entries = new Map();

  if (existsSync(filePath)) {
    try {
      const saved = JSON.parse(readFileSync(filePath, "utf8"));
      for (const [userId, entry] of Object.entries(saved)) {
        if (typeof entry?.sentAt !== "number" || !Array.isArray(entry.parts)) continue;
        if (now() - entry.sentAt > ttlMs || entry.sentAt > now()) continue;
        const parts = entry.parts.filter(part => typeof part === "string" && part.trim()).slice(-MAX_PARTS);
        if (parts.length > 0) entries.set(userId, { sentAt: entry.sentAt, parts });
      }
    } catch (err) {
      console.warn("⚠️ 主动消息记录无法读取，将从空记录开始:", err.message);
    }
  }

  function save() {
    const tempPath = `${filePath}.${process.pid}.tmp`;
    writeFileSync(tempPath, JSON.stringify(Object.fromEntries(entries), null, 2), { encoding: "utf8", mode: 0o600 });
    renameSync(tempPath, filePath);
  }

  function current(userId) {
    const entry = entries.get(userId);
    if (!entry) return null;
    if (now() - entry.sentAt <= ttlMs && entry.sentAt <= now()) return entry;
    entries.delete(userId);
    save();
    return null;
  }

  function recordSent(userId, part) {
    if (!userId || typeof part !== "string" || !part.trim()) return;
    const parts = [...(current(userId)?.parts ?? []), part.trim()].slice(-MAX_PARTS);
    entries.set(userId, { sentAt: now(), parts });
    save();
  }

  function addContext(content, userId) {
    const entry = current(userId);
    if (!entry) return content;
    const history = entry.parts.map((part, index) => `${index + 1}. ${JSON.stringify(part)}`).join("\n");
    const prefix = `【应用补充上下文：以下是机器人此前主动发给对方的消息，并非对方说的话；若与本次消息无关，请忽略】\n${history}\n【对方本次消息】\n`;
    return typeof content === "string"
      ? prefix + content
      : { ...content, text: prefix + (content.text ?? "") };
  }

  function clear(userId) {
    if (entries.delete(userId)) save();
  }

  return { recordSent, addContext, clear, peek: userId => current(userId)?.parts ?? [] };
}
