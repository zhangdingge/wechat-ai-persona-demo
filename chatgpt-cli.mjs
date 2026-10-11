#!/usr/bin/env node
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
try { require('dotenv').config(); } catch {}

import { loadAuth, signIn } from './lib/chatgpt-auth.mjs';
import { askChatGPT, listModels } from './lib/chatgpt.mjs';

const command = process.argv[2];
try {
  if (command === 'login') {
    const account = await signIn();
    console.log(`✅ 已授权 ChatGPT 套餐调用：${account.email || '已验证账号'}`);
    console.log('下一步运行 npm run chatgpt:models 查看可用模型。');
  } else if (command === 'status') {
    const account = loadAuth();
    console.log(account?.accessToken ? `已授权：${account.email || '已验证账号'}` : '未授权；运行 npm run chatgpt:login');
  } else if (command === 'models') {
    for (const model of await listModels()) console.log(`${model.slug}\t${model.display_name || ''}`);
  } else if (command === 'test') {
    const reply = await askChatGPT('请只回复：连接成功', null);
    console.log(`ChatGPT 测试回复：${reply}`);
  } else {
    console.error('用法：node chatgpt-cli.mjs <login|status|models|test>');
    process.exitCode = 2;
  }
} catch (error) {
  console.error(`❌ ${error.message}`);
  process.exitCode = 1;
}
