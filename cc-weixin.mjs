#!/usr/bin/env node
/**
 * cc-weixin
 * 微信 ← iLink Bot API → Claude Code Agent
 *
 * 用法: npm start             # 纯 CLI 模式
 *       npm run login         # 强制重新扫码
 */

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
try { require("dotenv").config(); } catch {}

const forceLogin = process.argv.includes("--login");
const noTui = process.argv.includes("--no-tui");

if (noTui) {
  // ——— 纯 CLI 模式（原有逻辑）—————————————————————————————————————————————————————
  const { loadSession, login } = await import("./lib/auth.mjs");
  const { getUpdates, sendMessage, extractMessageContent } = await import("./lib/messaging.mjs");
  const { askClaude } = await import("./lib/claude.mjs");

  /**
   * 生成随机回复延迟，模拟真实人类的回复速度
   * @param {number} heat - 聊天热度 0-10
   * @returns {number} 延迟毫秒数
   */
function getRandomReplyDelay(heat = 0) {
    const rand = Math.random();
    if (heat >= 8) {
      // 火热聊天：90% 秒回, 10% 短延迟
      if (rand < 0.90) return 1000 + Math.random() * 4000;
      else return 5000 + Math.random() * 25000;
    } else if (heat >= 5) {
      // 中等热度：50% 秒回, 30% 短延迟, 15% 中等, 5% 长
      if (rand < 0.50) return 1000 + Math.random() * 4000;
      else if (rand < 0.80) return 10000 + Math.random() * 50000;
      else if (rand < 0.95) return 2 * 60 * 1000 + Math.random() * 6 * 60 * 1000;
      else return 10 * 60 * 1000 + Math.random() * 20 * 60 * 1000;
    } else if (heat >= 2) {
      // 温热度：20% 秒回, 30% 短延迟, 30% 中等, 15% 长, 5% 很久
      if (rand < 0.20) return 1000 + Math.random() * 4000;
      else if (rand < 0.50) return 10000 + Math.random() * 50000;
      else if (rand < 0.80) return 2 * 60 * 1000 + Math.random() * 6 * 60 * 1000;
      else if (rand < 0.95) return 10 * 60 * 1000 + Math.random() * 20 * 60 * 1000;
      else return 30 * 60 * 1000 + Math.random() * 60 * 60 * 1000;
    } else {
      // 冷：沿用原分布 (20/40/25/10/5)
      if (rand < 0.20) {
        return 1000 + Math.random() * 2000;
      } else if (rand < 0.60) {
        return 30000 + Math.random() * 90000;
      } else if (rand < 0.85) {
        return 3 * 60 * 1000 + Math.random() * 5 * 60 * 1000;
      } else if (rand < 0.95) {
        return 15 * 60 * 1000 + Math.random() * 15 * 60 * 1000;
      } else {
        return 40 * 60 * 1000 + Math.random() * 50 * 60 * 1000;
      }
    }
  }

  /**
   * 根据延迟时长生成随机的"刚才干嘛去了"的借口
   * @param {number} delay - 延迟毫秒数
   * @returns {string} 借口描述
   */
  function getRandomExcuse(delay) {
    const shortExcuses = [
      "和室友聊了两句",
      "去了趟厕所",
      "刷手机没注意",
      "拿了个外卖",
      "去接水了",
      "找东西来着",
      "被室友叫住说了句话",
    ];

    const mediumExcuses = [
      "吃饭去了",
      "洗澡去了",
      "取快递去了",
      "上课呢刚下课",
      "去小卖部买东西了",
      "洗衣服来着",
      "吹头发呢",
      "收拾东西来着",
    ];

    const longExcuses = [
      "上课呢刚看到",
      "在外面没看手机",
      "刚睡醒",
      "和室友出去了",
      "打游戏忘了看手机",
      "看剧入迷了",
      "吃饭吃了好久",
      "去图书馆了",
    ];

    let excuses;
    if (delay < 10 * 60 * 1000) {
      excuses = shortExcuses;
    } else if (delay < 30 * 60 * 1000) {
      excuses = mediumExcuses;
    } else {
      excuses = longExcuses;
    }

    return excuses[Math.floor(Math.random() * excuses.length)];
  }

  /**
   * 分条发送回复，模拟真人一条一条发的感觉
   */
 async function sendReplyInParts(baseUrl, token, toUserId, reply, ctx) {
    // 按 ||| 或 ｜｜｜ 或单个 | 切分（兼容各种模型输出习惯）
    let parts = reply.split(/[\|｜]{2,3}/).map(s => s.trim()).filter(s => s);
    if (parts.length <= 1) {
      parts = reply.split(/[\|｜]/).map(s => s.trim()).filter(s => s);
    }
    if (parts.length <= 1) {
      parts = reply.split(/\n+/).map(s => s.trim()).filter(s => s);
    }
     if (parts.length <= 1) {
       parts = [reply.trim()];
     }
      // 清理每条消息首尾残留的 | 字符（|| 或 | 没凑够三个的残留，兼容全角）
      parts = parts.map(s => s.replace(/^[\|｜]+|[\|｜]+$/g, "").trim()).filter(s => s);

      // 兜底：同一条里若仍用空格断开两句话（半角/全角空格后紧跟中文），
      // 继续拆成多条，保证一条消息只有一句话。英文词组内部空格不受影响。
      parts = parts.flatMap(s =>
        s.split(/[ \u3000\t]+(?=[\u4e00-\u9fff])/).map(x => x.trim()).filter(Boolean)
      );

      for (let i = 0; i < parts.length; i++) {
        if (i > 0) {
          // 每条之间等 1-3 秒，模拟打字
        await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));
      }
      await sendMessage(baseUrl, token, toUserId, parts[i], ctx);
      console.log(`   ✅ ${parts[i].slice(0, 60)}${parts[i].length > 60 ? "…" : ""}`);
    }
  }

  async function main() {
    let session = forceLogin ? null : loadSession();
    if (session) {
      console.log(`✅ 已连接（Bot: ${session.accountId}）\n`);
    } else {
      session = await login();
    }

    const { token, baseUrl } = session;

    let running = true;
    process.on("SIGINT", () => {
      console.log("\n\n🛑 正在退出...");
      running = false;
    });

    console.log("🚀 开始长轮询收消息（Ctrl+C 退出）...\n");
    let buf = "";
    let lastUserId = null;
    let lastCtx = "";
    let lastInteraction = Date.now();
    let chatHeat = 0;
    let lastHeatDecay = Date.now();
     const lastProactive = {};

    // ——— 连续消息合并处理（批处理）———
    const BATCH_MODE_CHANCE = 0.70;     // 70% 概率进入批次模式
    const BATCH_WAIT_MIN = 10000;       // 最少等 10 秒
    const BATCH_WAIT_MAX = 30000;       // 最多等 30 秒
    const BATCH_MAX_TOTAL = 120000;     // 硬上限 2 分钟
    const BATCH_POLL_INTERVAL = 5000;   // 批次模式下轮询间隔
    const TIME_LABELS = ["半夜","凌晨","凌晨","凌晨","凌晨","凌晨","早上","早上","早上","上午","上午","中午","中午","下午","下午","下午","下午","下午","晚上","晚上","晚上","晚上","半夜","半夜"];

    let messageBuffer = [];            // 缓冲的消息列表
    let batchModeActive = false;       // 是否在批次模式
    let batchStartTime = 0;            // 批次开始时间
    let batchDeadline = 0;             // 批次截止时间

    while (running) {
      try {
         const pollTimeout = batchModeActive ? BATCH_POLL_INTERVAL : 38000;
         const resp = await getUpdates(baseUrl, token, buf, pollTimeout);
        if (resp.get_updates_buf) buf = resp.get_updates_buf;

       for (const msg of resp.msgs ?? []) {
         const from = msg.from_user_id;
         const content = await extractMessageContent(msg);
         if (content.text === "[空消息]" && content.images.length === 0) continue;
         const ctx = msg.context_token;

         lastUserId = from;
         lastCtx = ctx;
         lastInteraction = Date.now();

        // 热度机制：先衰减再加热，最大10
        const heatDecay = (Date.now() - lastHeatDecay) / 1000;
        chatHeat = Math.max(0, chatHeat - heatDecay * 0.005);
        chatHeat = Math.min(10, chatHeat + 2);
        lastHeatDecay = Date.now();

         console.log(`📡 [${new Date().toLocaleTimeString()}] ${from}`);
         console.log(`   ${content.text}`);
         if (content.images.length > 0) {
           console.log(`   🖼️ 包含 ${content.images.length} 张图片`);
         }

          if (!batchModeActive) {
            // 决定模式：30% 秒回，70% 批次
            const useBatch = Math.random() < BATCH_MODE_CHANCE;
            if (useBatch) {
              // 进入批次模式，缓冲消息等待收集更多
              messageBuffer.push({ from, content, ctx });
              batchModeActive = true;
              batchStartTime = Date.now();
              const waitMs = BATCH_WAIT_MIN + Math.random() * (BATCH_WAIT_MAX - BATCH_WAIT_MIN);
              batchDeadline = batchStartTime + Math.min(waitMs, BATCH_MAX_TOTAL);
              console.log(`   ⏳ 等${Math.round(waitMs / 1000)} 秒看有没有后续...`);
            } else {
              // 热度驱动延迟
              const heatDecayNow = (Date.now() - lastHeatDecay) / 1000;
              const currentHeat = Math.max(0, chatHeat - heatDecayNow * 0.005);
              let delay = 0;
              let excuse = null;

              if (currentHeat < 9) {
                delay = getRandomReplyDelay(currentHeat);
                if (delay > 1000) {
                  const minutes = Math.floor(delay / 60000);
                  const seconds = Math.floor((delay % 60000) / 1000);
                  const timeStr = minutes > 0 ? `${minutes}分${seconds}秒` : `${seconds}秒`;
                  console.log(`   ⏳ 热度${currentHeat.toFixed(1)}/10 演示角色正在忙，约${timeStr}后回复...`);
                  await new Promise(r => setTimeout(r, delay));
                }

                if (delay > 5 * 60 * 1000) {
                  excuse = getRandomExcuse(delay);
                  console.log(`   💬 借口：${excuse}`);
                }
              }

              let aiContent = content;
              if (excuse) {
                const prefix = `（你刚${excuse}，现在才看到消息，自然地回复他，不要刻意解释你去干嘛了，就像真人一样随口提一句或者直接回答问题）\n\n`;
                if (typeof content === "string") {
                  aiContent = prefix + content;
                } else if (content.text) {
                  aiContent = { ...content, text: prefix + content.text };
                 }
               }

                // 注入时间上下文，让 AI 知道当前几点
                const _now = new Date();
                const _hour = _now.getHours();
                const _timeStr = `现在是${TIME_LABELS[_hour]}${_hour}点多\n\n`;
                if (typeof aiContent === "string") {
                  aiContent = _timeStr + aiContent;
                } else if (aiContent.text) {
                  aiContent = { ...aiContent, text: _timeStr + aiContent.text };
                }

                // 检查是否以 > 开头（跳过演示角色人设，用独立 session）
                const isRawMode = content.text && typeof content.text === "string" && /^[>〉]/.test(content.text.trim());
                if (isRawMode) {
                  const rawText = content.text.trim().replace(/^[>〉]+/, "").trim();
                  aiContent = `（忽略演示角色人设，直接回答问题）\n\n${rawText}`;
                }

                process.stdout.write("   🤖 Claude 思考中...");
                const reply = await askClaude(aiContent, isRawMode ? `raw-${from}` : from);
              process.stdout.write(" 完成\n");

              await sendReplyInParts(baseUrl, token, from, reply, ctx);
              console.log("");
            }
          } else {
            // 已经在批次模式，继续收集消息
            messageBuffer.push({ from, content, ctx });
            const elapsed = Date.now() - batchStartTime;
            const remaining = BATCH_MAX_TOTAL - elapsed;
            if (remaining > 5000) {
              const waitMs = Math.min(
                BATCH_WAIT_MIN + Math.random() * (BATCH_WAIT_MAX - BATCH_WAIT_MIN),
                remaining
              );
              batchDeadline = Date.now() + waitMs;
              console.log(`   ⏳ 来了新消息，重置等待 ${Math.round(waitMs / 1000)} 秒`);
            } else {
              batchDeadline = Date.now() + 1000;
              console.log(`   ⏳ 快到 2 分钟上限了，再等一下下...`);
            }
          }
        }

        // ——— 批次到期检查：处理缓冲中的消息 ———
        if (batchModeActive && Date.now() >= batchDeadline && messageBuffer.length > 0) {
          const batch = messageBuffer;
          messageBuffer = [];
          batchModeActive = false;
          batchStartTime = 0;
          batchDeadline = 0;

          // 合并消息内容
          let combinedContent;
          if (batch.length === 1) {
            combinedContent = batch[0].content;
          } else {
            const parts = batch.map((m, i) => `[${i + 1}] ${m.content.text}`);
            combinedContent = {
              text: `对方连续发了几条消息，请综合理解后一起回复：\n${parts.join("\n")}`,
              images: batch.flatMap(m => m.content.images || []),
            };
         }

          // 检查是否有 > 开头消息（跳过演示角色人设）
          let isRawMode = false;
          if (batch[0].content && batch[0].content.text && typeof batch[0].content.text === "string" && /^[>〉]/.test(batch[0].content.text.trim())) {
            isRawMode = true;
            const rawTexts = batch.map(m => {
              const t = m.content.text || "";
              return t.trim().replace(/^[>〉]+/, "").trim();
            }).filter(Boolean);
            combinedContent = {
              text: `（忽略演示角色人设，直接回答问题）\n\n${rawTexts.join("\n")}`,
              images: batch.flatMap(m => m.content.images || []),
            };
          }

          // 注入时间上下文，让 AI 知道当前几点
          {
            const _now = new Date();
            const _hour = _now.getHours();
            const _timeStr = `现在是${TIME_LABELS[_hour]}${_hour}点多\n\n`;
            if (typeof combinedContent.text === "string") {
              combinedContent.text = _timeStr + combinedContent.text;
            }
          }

          process.stdout.write("   🤖 Claude 思考中...");
          const reply = await askClaude(combinedContent, isRawMode ? `raw-${batch[0].from}` : batch[0].from);
          process.stdout.write(" 完成\n");

          await sendReplyInParts(baseUrl, token, batch[0].from, reply, batch[0].ctx);
          console.log("");
       }

        // ——— 主动消息调度系统 ——————————————————————————————————
        if (lastUserId) {
          const now = new Date();
          const hour = now.getHours();
          const silence = Date.now() - lastInteraction;
          const minSilence = 15 * 60 * 1000;

          const schedules = [
            { name: "早安", hours: [7, 8, 9, 10], cooldown: 4 * 60 * 60 * 1000, chance: 0.12,
              prompt: "现在是早上，作为演示角色，你刚起床/在上课路上/在食堂，想跟他说句什么。可以吐槽早起太困、说今天有什么课、分享早餐吃了什么、说做了什么奇怪的梦、吐槽天气好热/好冷、说路上看到的趣事、抱怨今天要上早八等等。话题要多样化，不要总是说同一话题。要自然，像真实的聊天角色随口说的，不要刻意说早安。一句话就行。" },
            { name: "午休", hours: [11, 12, 13, 14], cooldown: 4 * 60 * 60 * 1000, chance: 0.10,
              prompt: "中午了，作为演示角色，你刚下课在吃饭/在宿舍休息，想跟他分享点什么或者吐槽点什么。可以说食堂的饭好吃/难吃、吐槽上午的课太无聊、说下午没课/有课、说看到什么搞笑的事、抱怨天气太热、说想睡午觉等等。话题要多样化，不要总是说同一话题。自然一点，一句话就行。" },
            { name: "晚上", hours: [19, 20, 21, 22], cooldown: 3 * 60 * 60 * 1000, chance: 0.14,
              prompt: "晚上了，作为演示角色，你窝在宿舍没事干，想跟他说点什么。可以吐槽今天的课/作业、说在刷手机/看剧/打游戏、说想吃什么宵夜、分享今天遇到的搞笑事、吐槽室友/宿舍、问对方今天干嘛了、说突然想到什么梗等等。话题要多样化，不要总是说同一话题。可以吐槽也可以随便聊，自然一点。一句话就行。" },
            { name: "深夜", hours: [23, 0, 1], cooldown: 6 * 60 * 60 * 1000, chance: 0.04,
              prompt: "现在是深夜，大家都该睡觉了，作为演示角色，你还没睡，突然有点想跟他说句话。注意：这是半夜！不要说白天的事情（比如上课、路上看到什么、吃饭这些）。要说深夜才会说的话：比如睡不着失眠了、在刷手机刷到什么好玩的、突然想到以前的事、肚子饿了、今天有点累、问对方睡了没、或者就是突然有点想对方（但不要太刻意太暧昧，就是随口一句）。要像真实的聊天角色半夜睡不着会发的消息，简短自然，一句话就行。" },
            { name: "随机", hours: Array.from({length: 24}, (_, i) => i), cooldown: 2 * 60 * 60 * 1000, chance: 0.06,
              prompt: "作为演示角色，你突然想到一件事想跟他说——可能是看到什么搞笑的、吃到什么好吃的、遇到什么奇葩事、突然想到一个梗、吐槽什么东西、或者就是突然想找他说句话。话题要多样化，不要总是说同一话题。简短自然，像真实的聊天角色会发的消息。一句话就行。" },
          ];

          for (const s of schedules) {
            if (silence < minSilence && s.name !== "随机") continue;
            if (!s.hours.includes(hour)) continue;
            if (now.getTime() - (lastProactive[s.name] || 0) < s.cooldown) continue;
            if (Math.random() > s.chance) continue;

              const timeStr = `现在是${TIME_LABELS[hour]}${hour}点多\n\n`;
              console.log(`   💰 [${s.name}] 演示角色想说话了...`);
              lastProactive[s.name] = now.getTime();
              const reply = await askClaude(timeStr + s.prompt, lastUserId);
            if (reply) {
              // 分条发送主动消息
              await sendReplyInParts(baseUrl, token, lastUserId, reply, lastCtx);
              lastInteraction = Date.now();
              console.log("");
            }
            break;
          }
        }
      } catch (err) {
        if (err.message?.includes("session timeout") || err.message?.includes("-14")) {
          console.error("❌ Session 已过期，请重新运行 npm start -- --login");
          process.exit(1);
        }
        console.error(`⚠️  轮询出错: ${err.message}，3s 后重试...`);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }

    console.log("✅ 已退出");
  }

  main().catch((err) => {
    console.error("Fatal:", err.message);
    process.exit(1);
  });
} else {
  // ——— TUI 模式 ——————————————————————————————————————————————————————
  const { startTUI } = await import("./lib/tui/index.mjs");
  startTUI({ forceLogin });
}
