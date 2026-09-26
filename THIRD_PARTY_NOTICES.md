# 来源说明

本仓库基于 [hao-ji-xing/cc-weixin](https://github.com/hao-ji-xing/cc-weixin) 的提交 `0998548`。上游作者为 `hao-ji-xing`，其 README 和 npm `package.json` 均声明 MIT 许可；上游提交历史保留在本仓库。微信桥接、登录、基础收发消息与 Claude Agent SDK 调用来自上游。

维护者与 AI 协作完成了本地改动，包括聊天热度和延迟、消息合并、分条发送、主动消息、图片处理、会话持久化、情绪状态及启动配置。现有文件没有逐行作者记录，无法区分其中每一行由维护者键入还是 AI 生成。

最初的环境部署及私人角色 Skill 接入曾由第三方协助。该服务过程没有保留可核对的逐文件修改记录，因此不把任何无法验证的初始配置归为维护者独立创作。私人角色 Skill 由 [`therealXiaomanChu/ex-skill`](https://github.com/therealXiaomanChu/ex-skill) 的 `create-ex` 工具生成或整理，未包含在本仓库。
