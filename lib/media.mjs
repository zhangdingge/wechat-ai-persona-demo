import { createDecipheriv } from "node:crypto";

const CDN_BASE = "https://novac2c.cdn.weixin.qq.com/c2c";

/**
 * AES-128-ECB 解密
 */
function decryptAesEcb(ciphertext, key) {
  const decipher = createDecipheriv("aes-128-ecb", key, null);
  decipher.setAutoPadding(true);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * 解析 AES 密钥
 * 支持三种格式：base64(原始16字节)、base64(十六进制字符串)、直接十六进制(32字符)
 */
function parseAesKey(aesKeyStr) {
  if (!aesKeyStr) return null;

  // 尝试直接十六进制 (32字符)
  if (/^[0-9a-fA-F]{32}$/.test(aesKeyStr)) {
    return Buffer.from(aesKeyStr, "hex");
  }

  // 尝试 base64 解码
  try {
    const decoded = Buffer.from(aesKeyStr, "base64");
    if (decoded.length === 16) {
      return decoded; // base64(原始16字节)
    }
    // 如果解码后是32字符的十六进制字符串
    const hexStr = decoded.toString("ascii");
    if (/^[0-9a-fA-F]{32}$/.test(hexStr)) {
      return Buffer.from(hexStr, "hex");
    }
  } catch {}

  return null;
}

/**
 * 从 CDN 下载并解密媒体文件
 * @param {string} encryptQueryParam - 加密查询参数
 * @param {string} aesKeyStr - AES 密钥
 * @returns {Promise<Buffer>} 解密后的文件内容
 */
export async function downloadMedia(encryptQueryParam, aesKeyStr) {
  if (!encryptQueryParam) throw new Error("缺少 encrypt_query_param");
  if (!aesKeyStr) throw new Error("缺少 aes_key");

  // 1. 从 CDN 下载加密文件
  const url = `${CDN_BASE}/download?encrypted_query_param=${encodeURIComponent(encryptQueryParam)}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`下载失败: HTTP ${response.status}`);
  }

  const encryptedBuffer = Buffer.from(await response.arrayBuffer());

  // 2. 解析密钥
  const aesKey = parseAesKey(aesKeyStr);
  if (!aesKey) {
    throw new Error("无法解析 AES 密钥");
  }

  // 3. 解密
  try {
    const decrypted = decryptAesEcb(encryptedBuffer, aesKey);
    return decrypted;
  } catch (err) {
    throw new Error(`解密失败: ${err.message}`);
  }
}

/**
 * 从图片消息 item 中提取图片并下载
 * @param {object} imageItem - 图片消息项
 * @returns {Promise<Buffer>} 图片内容
 */
export async function downloadImage(imageItem) {
  if (!imageItem) throw new Error("没有 image_item");

  // 尝试从不同字段获取加密参数和密钥
  const media = imageItem.media || {};
  const encryptQueryParam =
    media.encrypt_query_param ||
    media.download_param ||
    imageItem.encrypt_query_param ||
    imageItem.download_param;

  const aesKey =
    imageItem.aeskey ||
    imageItem.aes_key ||
    media.aeskey ||
    media.aes_key;

  if (!encryptQueryParam) {
    throw new Error("无法找到图片下载参数");
  }

  return downloadMedia(encryptQueryParam, aesKey);
}
