/**
 * 演示角色情绪面板 — 供 /状态 指令调用
 * 读取当前情绪状态并格式化输出
 */

const engine = require('./emotion-engine.cjs');
const { moodLabel, affectionLabel, energyLabel } = engine;
const state = engine.getCurrentState();

const bars = (val) => {
  const full = Math.round(val / 10);
  return '█'.repeat(full) + '░'.repeat(10 - full);
};

console.log('演示角色当前情绪');
console.log('');
console.log(`心情: ${state.mood}/100  ${bars(state.mood)}  ${moodLabel(state.mood)}`);
console.log(`好感: ${state.affection}/100  ${bars(state.affection)}  ${affectionLabel(state.affection)}`);
console.log(`精力: ${state.energy}/100  ${bars(state.energy)}  ${energyLabel(state.energy)}`);
console.log('');
console.log(`今天互动: ${state.todayInteractions || 0} 轮 | 总互动: ${state.totalInteractions || 0} 轮`);
console.log(`今日心情变化: ${state.dailyMoodDelta >= 0 ? '+' : ''}${state.dailyMoodDelta}  今日好感变化: ${state.dailyAffectionDelta >= 0 ? '+' : ''}${state.dailyAffectionDelta}`);
console.log(`最后更新: ${state.lastUpdate}`);
