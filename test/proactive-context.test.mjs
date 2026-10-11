import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createProactiveContextStore } from "../lib/proactive-context.mjs";

test("only sent bot messages are carried into the right user's next reply, including after restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "proactive-context-"));
  try {
    const path = join(dir, "pending.json");
    const store = createProactiveContextStore(path);
    store.recordSent("user-a", "今天有点累，你在干嘛？");
    store.recordSent("user-b", "晚上好");

    const restarted = createProactiveContextStore(path);
    const reply = restarted.addContext({ text: "刚吃完饭", images: ["image-placeholder"] }, "user-a");
    assert.match(reply.text, /机器人此前主动发给对方的消息/);
    assert.match(reply.text, /今天有点累，你在干嘛？/);
    assert.match(reply.text, /刚吃完饭/);
    assert.doesNotMatch(reply.text, /晚上好/);
    assert.deepEqual(reply.images, ["image-placeholder"]);
    assert.deepEqual(restarted.peek("user-b"), ["晚上好"]);

    restarted.clear("user-a");
    assert.equal(restarted.addContext("下一条正常消息", "user-a"), "下一条正常消息");
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8"))["user-a"], undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("expired proactive messages are not injected", () => {
  const dir = mkdtempSync(join(tmpdir(), "proactive-context-"));
  try {
    let clock = 1_000;
    const path = join(dir, "pending.json");
    const store = createProactiveContextStore(path, { now: () => clock, ttlMs: 5_000 });
    store.recordSent("user-a", "旧消息");
    clock += 5_001;
    assert.equal(store.addContext("新消息", "user-a"), "新消息");
    assert.deepEqual(store.peek("user-a"), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
