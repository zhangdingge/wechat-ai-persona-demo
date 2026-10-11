export const usingChatGPT = process.env.MODEL_PROVIDER === 'chatgpt';

export async function askAI(content, userId) {
  if (usingChatGPT) {
    const { askChatGPT } = await import('./chatgpt.mjs');
    return askChatGPT(content, userId);
  }
  const { askClaude } = await import('./claude.mjs');
  return askClaude(content, userId);
}

export async function rememberProactive(userId, text) {
  if (!usingChatGPT) return;
  const { rememberProactiveMessage } = await import('./chatgpt.mjs');
  rememberProactiveMessage(userId, text);
}

export async function rememberDelivered(userId, content, reply) {
  if (!usingChatGPT) return;
  const { rememberDeliveredExchange } = await import('./chatgpt.mjs');
  rememberDeliveredExchange(userId, content, reply);
}
