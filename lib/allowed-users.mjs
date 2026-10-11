export function parseAllowedUserIds(value) {
  return new Set((value ?? '').split(',').map(id => id.trim()).filter(Boolean));
}

export function isAllowedUser(allowedUserIds, userId) {
  return allowedUserIds.size === 0 || allowedUserIds.has(userId);
}

export function assertAllowedUserConfiguration(usingChatGPT, testProactiveOnce, allowedUserIds) {
  if (usingChatGPT && !testProactiveOnce && allowedUserIds.size === 0) {
    throw new Error('ChatGPT 普通模式需要在本地 .env 设置 WECHAT_ALLOWED_USER_IDS，防止其他联系人消耗套餐额度');
  }
}
