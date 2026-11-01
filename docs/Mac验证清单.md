# Mac 验证清单

这些步骤需要真实的 DSH（0.2.1-rc.5），只能在装了 DSH 的 Mac 上做。

## 0. 拉代码并安装
```sh
cd ~/Claude逆向工程
git clone https://github.com/znnw4m6k7k-dotcom/dsh-delivery.git dsh-delivery-repo   # 已克隆过就 git pull
cd dsh-delivery-repo/kit && sh install.sh
```
然后 Cmd+Q 完全退出 DSH，再打开。

## 1. 守卫生效（三期 A）— 2026-11-01 已在 Mac 上验证通过
> 冻结文件写入被 `[交付守卫]` 拒绝、文件未变；运行测试命令后 evidence.jsonl 追加记录；工作台命令输出正确。插件列表那一项因交付预设关闭了 plugin_manager 工具没法在会话里查，但拦截生效已能证明插件在运行。
- [ ] 新会话的插件列表里有 `delivery-guard`，并且已启用。
- [ ] 在一个有 `.delivery/` 的项目里冻结后（freeze.json 写好、还没有 qa/<版本>.json），让它改一个冻结文件，应被拒绝，提示以 `[交付守卫]` 开头。
- [ ] 运行 freeze.json 里的测试命令后，`.delivery/evidence.jsonl` 多了一行。

## 2. 新访谈规则试跑（社区健身房）
- [ ] 题目：“帮我做一份社区健身房开业方案”。
- [ ] 分 2–3 轮提问，不是一次问完。
- [ ] 先写“我理解的需求”请你确认，再列验收条目。

## 3. 复盘逐条确认（奶茶店会话）
- [ ] 在奶茶店会话里说“做复盘”。
- [ ] 候选经验逐条请你确认（确认 / 修改后确认 / 拒绝）。
- [ ] 只有确认过的写进 `~/.agents/skills/industry-<行业>/`；直接改 lessons.jsonl 会被守卫拒绝。

## 4. 交付工作台（三期 B）
- [ ] 在奶茶店或健身房会话里说“打开交付工作台”，它运行 `node ~/.dsh-delivery-kit/bundle/workbench/cli.mjs <项目目录>` 并展示页面。
- [ ] 页面上的验收条目、冻结版本、QA 结论和 `.delivery/` 里的文件一致。
- [ ] 也可以自己在终端运行上面的命令，然后 `open <项目>/.delivery/workbench.html`。

做完把结果（截图或哪一步不对）发回项目里即可。
