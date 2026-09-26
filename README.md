# 微信 AI 角色机器人（脱敏展示版）

这是一个在 [`cc-weixin`](https://github.com/hao-ji-xing/cc-weixin) 基础上扩展的个人学习项目。仓库保留了上游 Git 历史；原版说明见 [UPSTREAM_README.md](UPSTREAM_README.md)。

项目最初的 Node.js、Claude Code 环境和人物 Skill 接入由他人协助部署。此后的功能想法、需求选择、调试和迭代由项目维护者与 AI 协作完成。仓库中的改动不应被描述为维护者独立手写的全部代码。

## 本项目增加的内容

- 根据聊天热度调整回复延迟，并将连续消息合并处理。
- 将 `|||` 分隔的回复拆成多条微信消息。
- 根据时间段尝试主动发送简短消息。
- 接收图片并在支持视觉的模型上处理。
- 按用户和模型保存会话标识，失效时尝试恢复。
- 用独立情绪引擎生成角色状态；目前事件由命令手动触发，启动时同步到角色提示词。

这些功能主要在 `--no-tui` 模式实现。它是学习项目，尚未经过完整的生产环境测试。

## 本地运行

需要 Node.js 22 或更新版本，以及一个兼容 Claude Agent SDK 的模型服务。先复制 `.env.example` 为 `.env`，填入自己的密钥、服务地址和模型名。不要把 `.env` 提交到 Git。

```bash
npm install
cp .env.example .env
npm start
```

`npm start` 会先从 [CLAUDE_TEMPLATE.md](CLAUDE_TEMPLATE.md) 生成本地 `CLAUDE.md`，再启动微信机器人。首次登录可运行 `npm run login`。情绪事件可以手动触发，例如 `npm run emotion:event -- praised`。模型服务、微信接口和账号授权的可用性以各自当前规则为准。

公开版本使用虚构人物模板，不含原始聊天记录、真实人物设定、微信会话、访问令牌或 API Key。请只为虚构人物或已同意参与的人制作角色；与他人互动时清楚说明这是 AI。

## 来源与归属

上游微信桥接代码来自 [`hao-ji-xing/cc-weixin`](https://github.com/hao-ji-xing/cc-weixin)，本地起点为提交 `0998548`。上游仓库声明 MIT 许可。本仓库的扩展和脱敏改动见当前分支相对该提交的差异。原项目另使用过第三方 `create-ex` Skill 来生成私人角色资料；该 Skill、生成的人物资料及私人聊天内容均未放入本仓库。详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
