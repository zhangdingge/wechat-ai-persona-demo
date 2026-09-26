import crypto from "node:crypto";
import { apiPost } from "./api.mjs";
import { downloadImage } from "./media.mjs";

 /** 长轮询获取新消息
  * @param {number} [timeout] - 可选超时时间，默认 38000ms
  */
 export async function getUpdates(baseUrl, token, getUpdatesBuf, timeout) {
   const resp = await apiPost(
     baseUrl,
     "ilink/bot/getupdates",
     { get_updates_buf: getUpdatesBuf ?? "" },
     token,
     timeout ?? 38_000,
   );
  return resp ?? { ret: 0, msgs: [], get_updates_buf: getUpdatesBuf };
}

/** 发送文本消息 */
export async function sendMessage(baseUrl, token, toUserId, text, contextToken) {
  const clientId = `wcb-${crypto.randomUUID()}`;
  await apiPost(
    baseUrl,
    "ilink/bot/sendmessage",
    {
      msg: {
        from_user_id: "",
        to_user_id: toUserId,
        client_id: clientId,
        message_type: 2,
        message_state: 2,
        context_token: contextToken,
        item_list: [{ type: 1, text_item: { text } }],
      },
    },
    token,
  );
  return clientId;
}

/** 从消息 item_list 提取纯文本（兼容旧接口） */
export function extractText(msg) {
  for (const item of msg.item_list ?? []) {
    if (item.type === 1 && item.text_item?.text) return item.text_item.text;
    if (item.type === 3 && item.voice_item?.text) return `[语音] ${item.voice_item.text}`;
    if (item.type === 2) return "[图片]";
    if (item.type === 4) return `[文件] ${item.file_item?.file_name ?? ""}`;
    if (item.type === 5) return "[视频]";
  }
  return "[空消息]";
}

/**
 * 提取消息内容（支持多模态：文本、图片等）
 * @param {object} msg - 消息对象
 * @returns {Promise<{type: 'text' | 'mixed', text: string, images: Array<{buffer: Buffer, mimeType: string}>}>}
 */
export async function extractMessageContent(msg) {
  let text = "";
  const images = [];

  for (const item of msg.item_list ?? []) {
    // 文本消息
    if (item.type === 1 && item.text_item?.text) {
      text += item.text_item.text;
      continue;
    }

    // 语音消息（带 ASR 文本）
    if (item.type === 3 && item.voice_item?.text) {
      text += `[语音] ${item.voice_item.text}`;
      continue;
    }

    // 图片消息
    if (item.type === 2 && item.image_item) {
      try {
        const imageBuffer = await downloadImage(item.image_item);
        // 简单判断图片类型（通过文件头）
        const mimeType = detectImageType(imageBuffer);
        images.push({ buffer: imageBuffer, mimeType });
        text += "[图片]";
      } catch (err) {
        console.error("⚠️  图片下载失败:", err.message);
        text += "[图片]";
      }
      continue;
    }

    // 文件消息
    if (item.type === 4) {
      text += `[文件] ${item.file_item?.file_name ?? ""}`;
      continue;
    }

    // 视频消息
    if (item.type === 5) {
      text += "[视频]";
      continue;
    }
  }

  if (!text && images.length === 0) {
    return { type: "text", text: "[空消息]", images: [] };
  }

  return {
    type: images.length > 0 ? "mixed" : "text",
    text: text || "请查看图片",
    images,
  };
}

/**
 * 根据文件头检测图片类型
 */
function detectImageType(buffer) {
  if (buffer.length < 4) return "image/jpeg";

  const header = buffer.slice(0, 4).toString("hex");

  // PNG: 89 50 4E 47
  if (header.startsWith("89504e47")) return "image/png";
  // GIF: 47 49 46 38
  if (header.startsWith("47494638")) return "image/gif";
  // WebP: 52 49 46 46 ... 57 45 42 50
  if (header.startsWith("52494646") && buffer.slice(8, 12).toString("hex") === "57454250") {
    return "image/webp";
  }
  // BMP: 42 4D
  if (header.startsWith("424d")) return "image/bmp";
  // 默认 JPEG
  return "image/jpeg";
}
