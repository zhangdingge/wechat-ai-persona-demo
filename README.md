# 微信 AI 角色机器人（脱敏展示版）

这是一个在 [`cc-weixin`](https://github.com/hao-ji-xing/cc-weixin) 基础上扩展的个人学习项目。仓库保留了上游 Git 历史；原版说明见 [UPSTREAM_README.md](UPSTREAM_README.md)。

项目最初的 Node.js、Claude Code 环境和人物 Skill 接入由他人协助部署。此后的功能想法、需求选择、调试和迭代由项目维护者与 AI 协作完成。仓库中的改动不应被描述为维护者独立手写的全部代码。

## 本项目增加的内容

- 根据聊天热度调整回复延迟，并将连续消息合并处理。
- 将 `|||` 分隔的回复拆成多条微信消息。
- 根据时间段尝试主动发送简短消息。
- 接收图片并在支持视觉的模型上处理。
- 按用户和模型保存会话标识，失效时尝试恢复。
- 用独立情绪引擎生成角色状态；目前事件由命令手动触发，启动时同步到角色提示词。微信聊天内容不会自动改变情绪状态。

这些功能主要在 `--no-tui` 模式实现。它是学习项目，尚未经过完整的生产环境测试。

## 本地运行

需要 Node.js 22 或更新版本。默认模式使用兼容 Claude Agent SDK 的模型服务：复制 `.env.example` 为 `.env`，填入自己的密钥、服务地址和模型名。不要把 `.env` 提交到 Git。

```bash
npm install
cp .env.example .env
npm start
```

`npm start` 会先从 [CLAUDE_TEMPLATE.md](CLAUDE_TEMPLATE.md) 生成本地 `CLAUDE.md`，再启动微信机器人。首次登录可运行 `npm run login`。情绪事件可以手动触发，例如 `npm run emotion:event -- praised`；事件只更新本地状态，聊天消息不会自动触发事件。启动前才会将状态同步进提示词，因此运行中的事件不会实时更新提示词。模型服务、微信接口和账号授权的可用性以各自当前规则为准。

默认 Claude 命令行模式会处理收到的联系人消息。若只想让指定微信用户触发回复和主动消息，可在本地 `.env` 中设置 `WECHAT_ALLOWED_USER_IDS`，多个完整用户 ID 用英文逗号分隔；留空或不设置表示不限制。ChatGPT 普通模式必须设置此项，否则启动时会报错，防止其他联系人消耗套餐额度。单次主动消息测试仍可仅凭触发语运行。首次测试时，终端的 `📡` 行会显示触发者的完整 ID；确认是自己的微信账号后，把该 ID 填进本地 `.env`。不要把真实 ID 写入仓库。测试模式的 `WECHAT_TEST_USER_ID` 限制仍独立生效。

### 使用 ChatGPT 套餐授权（本地试验）

将 `.env` 中的 `MODEL_PROVIDER` 改为 `chatgpt`。此模式使用 [OpenAI 官方公开客户端授权流程](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)，不使用 OpenAI API Key，也不会自动继承 Codex 或浏览器的登录状态。然后依次运行：

```bash
npm run chatgpt:login
npm run chatgpt:models
npm run chatgpt:test
npm start
```

第一步会在系统浏览器打开 ChatGPT 授权页，须由账号持有人自行同意。`chatgpt:models` 列出该账号实际可用的模型；如需指定，将某个 `slug` 填入 `.env` 的 `CHATGPT_MODEL`，否则默认使用列表中的第一个模型。`chatgpt:test` 只做一次文字调用，不连接微信。运行微信机器人前，先停掉使用同一微信 Bot 凭据的其他进程。

在 macOS 上登录命令会尝试直接打开 Safari。如果没有打开，可运行 `CHATGPT_MANUAL_BROWSER=1 npm run chatgpt:login`，把终端显示的一次性链接粘贴到同一台电脑的 Safari；链接和本机回调只在该次命令运行期间有效，等待约 10 分钟后会超时，超时就重新运行命令。请在浏览器中核对账号与授权范围并亲自完成授权。

此模式只在 `npm start` 的命令行模式接入；旧的 TUI 仍使用 Claude Agent SDK。角色提示词来自本地生成的 `CLAUDE.md`，不加载 Claude Code 的 Skill 或工具。聊天历史由本程序保存在 `chatgpt-history.json`，包含微信消息正文；图片只用于当次调用，历史中仅留“附带图片”的文字标记。普通回复的用户与助手两条记录在微信各部分发送成功后一起写入；发送失败则不写入该轮。主动消息在此模式下按成功发送的部分逐条记为助手发言。授权令牌保存在 `.chatgpt-auth.json`；两个文件均被 Git 忽略并设为仅当前用户可读。模型请求和回复流设有最长等待时间，避免网络卡住后无限等待。ChatGPT Plus 的套餐调用额度与其他使用同一套餐的应用共享，具体可用模型和调用上限以账号授权结果为准。

默认模型模式下，主动消息用不持久化的临时会话生成，生成指令不会进入收件人的普通会话。发送成功的实际文字会暂存在本地 `pending-proactive.json`（已被 Git 忽略，8 小时后过期），供该用户下一次普通消息接话；这段补充上下文会作为有明确标记的用户输入保存，并非严格意义上的独立助手消息。ChatGPT 模式则将成功发送的主动消息作为助手发言记入本地历史。可运行 `npm test` 做本地验证。要在自己的测试账号里立即验证一次主动发话，先停掉使用同一微信 Bot 凭据的旧进程，再设置一次性触发语运行 `WECHAT_TEST_TRIGGER='自定测试语' npm start -- --test-proactive-once`。用自己的微信账号向机器人发送完全相同的触发语，等它正常回复并额外主动发话后，再回复那条主动消息。测试模式会忽略触发语出现前的其他消息、只回应触发语发送者，并跳过随机等待与批处理，只主动触发一次。

如果默认模型服务返回 `402 Insufficient account balance`，程序会停止；请检查本地 `.env` 配置的模型平台账户余额或更换可用的 API Key，再重新启动。微信 Bot 已连接只表示微信侧登录成功，不代表模型 API 可用。

公开版本使用虚构人物模板，不含原始聊天记录、真实人物设定、微信会话、访问令牌或 API Key。请只为虚构人物或已同意参与的人制作角色；与他人互动时清楚说明这是 AI。

## 来源与归属

上游微信桥接代码来自 [`hao-ji-xing/cc-weixin`](https://github.com/hao-ji-xing/cc-weixin)，本地起点为提交 `0998548`。上游仓库声明 MIT 许可。本仓库的扩展和脱敏改动见当前分支相对该提交的差异。原项目另使用过第三方 `create-ex` Skill 来生成私人角色资料；该 Skill、生成的人物资料及私人聊天内容均未放入本仓库。详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
