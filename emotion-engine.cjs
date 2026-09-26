/**
 * 演示角色情绪引擎 — 核心计算模块
 *
 * 三个维度: mood(心情), affection(好感), energy(精力)
 * 变化来源: 时间衰减 + 对话事件 + 情绪联动 + 软上限
 */

const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, 'emotion-state.json');

// ── 事件定义: [min, max] ──────────────────────────────────────────
const EVENTS = {
  praised:          { mood: [5, 10],   affection: [2, 4],  energy: [0, 3]   },
  argued:           { mood: [-20, -10], affection: [-8, -3], energy: [-5, 0] },
  deep_talk:        { mood: [3, 8],    affection: [3, 6],  energy: [0, 0]   },
  flirted:          { mood: [5, 8],    affection: [2, 5],  energy: [0, 2]   },
  long_silence:     { mood: [-10, -5], affection: [-2, -1], energy: [0, 0]   },
  cared:            { mood: [8, 12],   affection: [3, 6],  energy: [0, 3]   },
  deep_chat:        { mood: [3, 5],    affection: [2, 4],  energy: [-5, 0]  },
  upset_topic:      { mood: [-15, -5], affection: [0, 0],  energy: [-10, 0] },
  short_reply:      { mood: [-8, -3],  affection: [-3, -1], energy: [0, 0]   },
  jealous_trigger:  { mood: [-10, -5], affection: [0, 0],  energy: [-3, 0]  },
  hurt_trigger:     { mood: [-10, -5], affection: [0, 0],  energy: [-3, 0]  },
  jh_resolved:      { mood: [0, 5],    affection: [0, 1],  energy: [0, 2]   },
  jh_unresolved:    { mood: [-10, 0],  affection: [-1, 0], energy: [0, 0]   },
  random_fluct:     { mood: [-2, 5],   affection: [0, 0],  energy: [0, 0]   },
};

// ── 常量 ──────────────────────────────────────────────────────────
const MOOD_DECAY_PER_HOUR = -2;        // 每小时心情衰减
const MOOD_DECAY_FLOOR = 30;           // 衰减下限
const MOOD_BASELINE = 50;              // 每日重置基线
const DAILY_MOOD_CAP = 50;             // 单日心情波动上限
const DAILY_AFFECTION_CAP = 15;        // 单日好感变化上限
const AFFECTION_HARD_CAP = 95;         // 好感硬上限
const AFFECTION_SINGLE_MAX = 6;        // 好感单次变化上限
const MOOD_SINGLE_MAX = 25;            // 心情单次变化上限
const AFFECTION_LOW_THRESHOLD = 30;    // 好感低位阈值
const AFFECTION_RECOVERY_BONUS = 10;   // 低位回暖加成

// ── 工具函数 ──────────────────────────────────────────────────────

function rand(min, max) {
  return Math.round(Math.random() * (max - min) + min);
}

function clamp(val, lo, hi) {
  return Math.max(lo, Math.min(hi, val));
}

function nowStr() {
  return new Date().toISOString();
}

/** 当前小时 (北京时间) */
function currentHour() {
  const utc = new Date();
  return (utc.getUTCHours() + 8) % 24;
}

/** 是否为同一天 */
function isSameDay(d1, d2) {
  if (!d1 || !d2) return false;
  return new Date(d1).toDateString() === new Date(d2).toDateString();
}

// ── 状态 I/O ──────────────────────────────────────────────────────

function readState() {
  if (!fs.existsSync(STATE_FILE)) {
    writeState({
      mood: 55,
      affection: 55,
      energy: 65,
      lastUpdate: nowStr(),
      totalInteractions: 0,
      todayInteractions: 0,
      lastInteractionTime: null,
      dailyMoodDelta: 0,
      dailyAffectionDelta: 0,
      streakDays: 0,
      lastStreakDate: null,
    });
  }
  return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
}

function writeState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

// ── 时间计算 ──────────────────────────────────────────────────────

/** 根据当前时间计算精力值 */
function calcEnergy() {
  const h = currentHour();
  if (h >= 0 && h < 6)   return rand(15, 35);   // 深夜
  if (h >= 6 && h < 10)   return rand(50, 70);   // 早上
  if (h >= 10 && h < 18)  return rand(65, 90);   // 白天
  return rand(40, 70);                           // 晚上
}

/** 计算距离上次交互的小时数 */
function hoursSince(lastTime) {
  if (!lastTime) return Infinity;
  return (Date.now() - new Date(lastTime).getTime()) / (1000 * 60 * 60);
}

// ── 软上限缩放 ────────────────────────────────────────────────────

/**
 * 好感度越高，增长越慢
 * 0-60: 100%, 60-80: 50%, 80-90: 25%, 90-95: 25%
 */
function affectionGainScale(affection) {
  if (affection < 60) return 1;
  if (affection < 80) return 0.5;
  return 0.25;
}

/** 好感度衰减速率 */
function affectionDecayRate(affection) {
  if (affection < 60) return 0;
  if (affection < 80) return -1;
  if (affection < 90) return -2;
  return -3;
}

// ── 每日重置 & 衰减 ───────────────────────────────────────────────

function applyDailyReset(state) {
  const now = new Date();
  const last = state.lastUpdate ? new Date(state.lastUpdate) : null;

  if (!last || !isSameDay(now.toISOString(), last.toISOString())) {
    // 新的一天
    state.mood = MOOD_BASELINE;
    state.dailyMoodDelta = 0;
    state.dailyAffectionDelta = 0;
    state.todayInteractions = 0;

    // 好感日常衰减 (每天不聊天)
    const h = last ? Math.floor((now - last) / (1000 * 60 * 60 * 24)) : 0;
    if (h >= 1) {
      const decay = Math.round(affectionDecayRate(state.affection) * h);
      state.affection = clamp(state.affection + decay, 0, AFFECTION_HARD_CAP);
    }

    // 检查连续聊天天数
    if (last && h === 0 && state.streakDays !== undefined) {
      // 前一天有互动
    }
  }
}

function applyTimeDecay(state) {
  const h = hoursSince(state.lastInteractionTime);
  if (h > 0 && h < 48) {
    const decay = Math.round(MOOD_DECAY_PER_HOUR * h);
    state.mood = clamp(state.mood + decay, MOOD_DECAY_FLOOR, 100);
  }

  // 精力值始终按当前时段重算
  state.energy = calcEnergy();

  state.lastUpdate = nowStr();
}

// ── 获取当前情绪 (含时间衰减) ─────────────────────────────────────

function getCurrentState() {
  const state = readState();
  applyDailyReset(state);
  applyTimeDecay(state);
  // 不写回，这只是查询
  return state;
}

// ── 事件应用 ──────────────────────────────────────────────────────

function applyEvent(eventName) {
  const state = readState();
  applyDailyReset(state);
  applyTimeDecay(state);

  const ev = EVENTS[eventName];
  if (!ev) throw new Error(`Unknown event: ${eventName}`);

  // 计算变化量
  let dMood = rand(ev.mood[0], ev.mood[1]);
  let dAffection = rand(ev.affection[0], ev.affection[1]);
  let dEnergy = rand(ev.energy[0], ev.energy[1]);

  // ── 情绪联动规则 ──
  // 好感 >= 70: 被怼扣分减少30%
  if (eventName === 'argued' && state.affection >= 70) {
    dMood = Math.round(dMood * 0.7);
  }

  // 精力 <= 20: 正面加成减半
  if (state.energy <= 20 && dMood > 0) {
    dMood = Math.round(dMood * 0.5);
    dAffection = Math.round(dAffection * 0.5);
  }

  // 心情 <= 20: 好感每小时额外-1 (在状态里标记)
  // (这个逻辑太细，暂不单独处理每小时粒度)

  // ── 软上限缩放好感增长 ──
  if (dAffection > 0) {
    dAffection = Math.round(dAffection * affectionGainScale(state.affection));
  }

  // ── 单次变化上限 ──
  dMood = clamp(dMood, -MOOD_SINGLE_MAX, MOOD_SINGLE_MAX);
  dAffection = clamp(dAffection, -AFFECTION_SINGLE_MAX, AFFECTION_SINGLE_MAX);

  // ── 每日波动上限 ──
  const newDailyMood = state.dailyMoodDelta + dMood;
  const newDailyAffection = state.dailyAffectionDelta + dAffection;

  if (Math.abs(newDailyMood) > DAILY_MOOD_CAP) {
    dMood = dMood > 0
      ? DAILY_MOOD_CAP - state.dailyMoodDelta
      : -DAILY_MOOD_CAP - state.dailyMoodDelta;
  }
  if (Math.abs(newDailyAffection) > DAILY_AFFECTION_CAP) {
    dAffection = dAffection > 0
      ? DAILY_AFFECTION_CAP - state.dailyAffectionDelta
      : -DAILY_AFFECTION_CAP - state.dailyAffectionDelta;
  }

  // ── 应用 ──
  state.mood = clamp(state.mood + dMood, 0, 100);
  state.affection = clamp(state.affection + dAffection, 0, AFFECTION_HARD_CAP);
  state.energy = clamp(state.energy + dEnergy, 0, 100);

  state.dailyMoodDelta = (state.dailyMoodDelta || 0) + dMood;
  state.dailyAffectionDelta = (state.dailyAffectionDelta || 0) + dAffection;
  state.todayInteractions = (state.todayInteractions || 0) + 1;
  state.totalInteractions = (state.totalInteractions || 0) + 1;
  state.lastInteractionTime = nowStr();
  state.lastUpdate = nowStr();

  writeState(state);
  return state;
}

// ── 情绪 Prompt 生成 ──────────────────────────────────────────────

function moodLabel(val) {
  if (val >= 90) return '特别开心';
  if (val >= 70) return '比较开心';
  if (val >= 40) return '平静';
  if (val >= 20) return '有点低落';
  return '烦躁';
}

function affectionLabel(val) {
  if (val >= 80) return '很喜欢他';
  if (val >= 50) return '有点好感';
  if (val >= 20) return '一般般';
  return '有点冷淡';
}

function energyLabel(val) {
  if (val >= 70) return '精力充沛';
  if (val >= 30) return '正常';
  return '有点累';
}

function moodDescription(val) {
  if (val >= 90) return '你现在特别开心，话多爱笑，动不动就想撒娇，看到什么都觉得好玩';
  if (val >= 70) return '你现在心情还不错，比平时活泼一点，更容易被逗笑';
  if (val >= 40) return '你现在心情比较平静，不好不坏，就那样';
  if (val >= 20) return '你现在有点低落，不想说太多话，容易不耐烦';
  return '你现在很烦躁，谁都不想理，说话会很冲';
}

function affectionDescription(val) {
  if (val >= 80) return '你对他好感很高，会主动撒娇、说暧昧的话、愿意说心里话';
  if (val >= 50) return '你对他有点好感，偶尔会撩一下，但大部分时候嘴硬';
  if (val >= 20) return '你对他感觉一般，回复会比较公事公办，不太撒娇';
  return '你现在对他有点冷淡，不太想暧昧，刻意保持距离';
}

function energyDescription(val) {
  if (val >= 70) return '你现在精神很好，愿意聊，什么话题都能接';
  if (val >= 30) return '你精力还行，正常聊没问题';
  return '你现在有点累了，回复会比较短，不想聊太复杂的话题';
}

function generateEmotionPrompt(state) {
  const m = state.mood;
  const a = state.affection;
  const e = state.energy;

  return [
    '## 当前情绪（系统生成，禁止直接说出口）',
    '',
    `你现在的心情: ${moodLabel(m)}（${m}/100）`,
    `你对他的好感: ${affectionLabel(a)}（${a}/100）`,
    `你的精力: ${energyLabel(e)}（${e}/100）`,
    '',
    '注意：',
    '- 情绪只影响你的回复方式和语气，绝对不要直接说出来',
    `- ${moodDescription(m)}`,
    `- ${affectionDescription(a)}`,
    `- ${energyDescription(e)}`,
    '- 性格核心不变，你还是那个嘴硬心软、古灵精怪的演示角色',
  ].join('\n');
}

// ── 注入至 CLAUDE.md ──────────────────────────────────────────────

const CLAUDE_TEMPLATE = path.join(__dirname, 'CLAUDE_TEMPLATE.md');
const CLAUDE_OUTPUT = path.join(__dirname, 'CLAUDE.md');
const PLACEHOLDER = '<!-- EMOTION_INJECTION_POINT -->';

function injectEmotionIntoClaudeMd() {
  const state = getCurrentState();
  const prompt = generateEmotionPrompt(state);

  let template;
  if (fs.existsSync(CLAUDE_TEMPLATE)) {
    template = fs.readFileSync(CLAUDE_TEMPLATE, 'utf8');
  } else {
    // 第一次运行: 用当前 CLAUDE.md 作为模板
    template = fs.readFileSync(CLAUDE_OUTPUT, 'utf8');
    // 保存模板(去掉旧的情绪区块)
    const idx = template.indexOf('## 当前情绪（系统生成');
    if (idx > 0) {
      template = template.substring(0, idx).trimEnd() + '\n\n' + PLACEHOLDER + '\n';
    } else {
      template = template.trimEnd() + '\n\n' + PLACEHOLDER + '\n';
    }
    fs.writeFileSync(CLAUDE_TEMPLATE, template, 'utf8');
    console.log('CLAUDE_TEMPLATE.md 已创建 (从当前 CLAUDE.md)');
  }

  const final = template.replace(PLACEHOLDER, prompt);
  fs.writeFileSync(CLAUDE_OUTPUT, final, 'utf8');
  console.log('CLAUDE.md 已注入情绪状态');

  // Public draft keeps generated persona data inside this project only.
}

// ── 导出 ──────────────────────────────────────────────────────────

module.exports = {
  EVENTS,
  getCurrentState,
  applyEvent,
  generateEmotionPrompt,
  injectEmotionIntoClaudeMd,
  readState,
  writeState,
  STATE_FILE,
  moodLabel,
  affectionLabel,
  energyLabel,
};

// ── CLI ────────────────────────────────────────────────────────────

if (require.main === module) {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (cmd === 'show') {
    const state = getCurrentState();
    console.log('演示角色当前情绪');
    console.log(`心情: ${state.mood}/100（${moodLabel(state.mood)}）`);
    console.log(`好感: ${state.affection}/100（${affectionLabel(state.affection)}）`);
    console.log(`精力: ${state.energy}/100（${energyLabel(state.energy)}）`);
    console.log(`今天互动: ${state.todayInteractions || 0} 轮 | 总互动: ${state.totalInteractions || 0} 轮`);
    console.log(`最后更新: ${state.lastUpdate}`);
    // 同时输出 prompt 预览
    console.log('\n─── Prompt 注入内容 ───');
    console.log(generateEmotionPrompt(state));
  } else if (cmd === 'event') {
    const eventName = args[1];
    if (!eventName) {
      console.log('可触发事件:');
      Object.keys(EVENTS).forEach(k => console.log(`  - ${k}`));
      process.exit(1);
    }
    const newState = applyEvent(eventName);
    console.log('事件应用完成');
    console.log(`心情: ${newState.mood}/100  好感: ${newState.affection}/100  精力: ${newState.energy}/100`);
    console.log(`今日心情变化: ${newState.dailyMoodDelta}  今日好感变化: ${newState.dailyAffectionDelta}`);
  } else if (cmd === 'sync') {
    injectEmotionIntoClaudeMd();
  } else if (cmd === 'reset') {
    const init = {
      mood: 55,
      affection: 55,
      energy: 65,
      lastUpdate: nowStr(),
      totalInteractions: 0,
      todayInteractions: 0,
      lastInteractionTime: null,
      dailyMoodDelta: 0,
      dailyAffectionDelta: 0,
      streakDays: 0,
      lastStreakDate: null,
    };
    writeState(init);
    console.log('情绪状态已重置为初始值');
  } else {
    console.log('用法: node emotion-engine.cjs <show|event <name>|sync|reset>');
    console.log('');
    console.log('  show             查看当前情绪状态');
    console.log('  event <name>     触发一个对话事件');
    console.log('  sync             注入情绪到本项目的 CLAUDE.md');
    console.log('  reset            重置为初始值');
    console.log('');
    console.log('可用事件:');
    Object.keys(EVENTS).forEach(k => console.log(`  - ${k}`));
  }
}
