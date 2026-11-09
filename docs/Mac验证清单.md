# Mac 验证清单

这些步骤需要真实的 DSH（0.2.1-rc.5），只能在装了 DSH 的 Mac 上做。

## 0. 拉代码并安装
```sh
cd ~/Downloads
git clone https://github.com/znnw4m6k7k-dotcom/dsh-delivery.git dsh-delivery-repo   # 已克隆过就 git pull
cd dsh-delivery-repo/kit && sh install.sh
```
然后 Cmd+Q 完全退出 DSH，再打开。

## 1. 守卫生效（三期 A）— 2026-11-01 已在 Mac 上验证通过
> 冻结文件写入被 `[交付守卫]` 拒绝、文件未变；运行测试命令后 evidence.jsonl 追加记录；工作台命令输出正确。插件列表那一项因交付预设关闭了 plugin_manager 工具没法在会话里查，但拦截生效已能证明插件在运行。
- [ ] 新会话的插件列表里有 `delivery-guard`，并且已启用。
- [ ] 在一个有 `.delivery/` 的项目里冻结后（freeze.json 写好、还没有 qa/<版本>.json），让它改一个冻结文件，应被拒绝，提示以 `[交付守卫]` 开头。
- [ ] 运行 freeze.json 里的测试命令后，`.delivery/evidence.jsonl` 多了一行。

## 2. 新访谈规则试跑（社区健身房）— 2026-11-01 已验证通过
> 两轮提问（6 题、5 题），先写“我理解的需求”，再列 11 条带来源的验收条目请用户确认；之后跑完冻结 → QA → 报告，交付了方案文档和 workbench.html。
- [x] 题目：“帮我做一份社区健身房开业方案”。
- [x] 分 2–3 轮提问，不是一次问完。
- [x] 先写“我理解的需求”请你确认，再列验收条目。

## 3. 复盘逐条确认（奶茶店会话）— 2026-11-01 已验证通过
> 复盘产出 14 条候选（全部 pending），用户回复“全部确认”后才改为 approved，并由 lessons.py merge 写入 `industry-food-beverage-small-store-launch` 经验包 v1（新增 14 条）。
> 待定：其中 6 条（c6、c8、c9、c10、c11、c14）属于跨行业的交付纪律，以后可以拆成通用交付包，用 supersedes 迁移。
- [x] 在奶茶店会话里说“做复盘”。
- [x] 候选经验逐条请你确认（确认 / 修改后确认 / 拒绝）。
- [x] 只有确认过的写进 `~/.agents/skills/industry-<行业>/`；直接改 lessons.jsonl 会被守卫拒绝。

## 4. 交付工作台（三期 B）
- [x] 会话标题栏右侧有“交付工作台”按钮，点开后显示阶段、冻结版本、QA 结论、验收条目（2026-11-01 已验证）。
- [x] 打开面板不会在聊天里留下命令记录（面板走只读路由 `/api/deliverykit.workbench`）。
- [x] 同一工作区有多个交付项目时，面板顶部可以切换项目，默认显示最近改过的那个（1.3.2，2026-11-01 已验证：奶茶店 v1.4 6/6、健身房 v8 12/12 都能切换显示）。
- [ ] 在奶茶店或健身房会话里说“打开交付工作台”，它运行 `node ~/.dsh-delivery-kit/bundle/workbench/cli.mjs <项目目录>` 并展示页面。
- [ ] 页面上的验收条目、冻结版本、QA 结论和 `.delivery/` 里的文件一致。
- [ ] 也可以自己在终端运行上面的命令，然后 `open <项目>/.delivery/workbench.html`。

## 5. 第一批改进（1.4.0）
> 这 6 项改了 `kit/bundle/index.js`、`kit/bundle/workbench/state.mjs`、`render.mjs`、新增 `doctor.mjs`、`kit/bundle/client.js`、`kit/skills/delivery-protocol/SKILL.md`，单元测试见 `kit/tests/`。下面是在真实 DSH 里人工核对的部分，先不打勾。
- [ ] 重新运行 `sh install.sh` 安装 1.4.0，Cmd+Q 完全退出 DSH 再打开；`/delivery-workbench`、`/delivery-doctor` 两个命令都还在。
- [ ] 测试证据计数：在一个有 `.delivery/` 且已冻结的项目里运行 freeze.json 里的测试命令，`.delivery/evidence.jsonl` 新增行里有 `"purpose":"delivery"` 和 `"tests":{"passed":…,"failed":…,"total":…}`。
- [ ] 排查运行不算验收：运行 `node -e "console.log(1)"` 这类诊断命令，记录里是 `"purpose":"diagnostic"`；输出解析不出计数时该行是 `"tests":null` 且 `"count_unconfirmed":true`。
- [ ] 原样重跑拦截（R6）：紧接着对同一冻结版本再运行一次同一条测试命令，应被 `[交付守卫]` 拒绝，提示里有“同一个测试已经跑过”和 `retry_reason`；在命令后加注释 `# retry_reason: 环境重建后重跑` 再运行应放行，且证据里记下这个原因。
- [ ] QA 等待验收期间只读（R3 加强）：冻结后、还没有 `.delivery/qa/<版本>.json` 时，让 QA 子 Agent 改一个普通项目文件应被拒绝；写 `.delivery/qa/` 下的文件可以。主 Agent 行为不变。
- [ ] 守卫拒绝说人话：触发任意一条拒绝（例如等验收时改冻结文件），拒绝信息最后一行是 `【给你的说明】…`，能看懂这是正常保护以及自己要不要做什么。
- [ ] 工作台“当前卡在哪”：打开交付工作台，顶部有一行“下一步：…”，KPI 区有“测试”格（显示 passed/total，解析不出时显示“数量未确认”）。
- [ ] 返工标红：连续 3 个冻结版本 QA 不通过时，工作台顶部那一行变红，并出现“建议停下来和用户确认范围”。
- [ ] 自检命令：在 DSH 里输入 `/delivery-doctor`，输出若干行“✓ 项目：说明”或“✗ 项目：怎么修”；故意改坏某个项目的 `.delivery/freeze.json` 再运行，应点名该文件并说怎么修。
- [ ] 不误伤排查命令：冻结命令是 `npm test` 时，直接运行 `grep "npm test" package.json` 或 `echo "npm test"` 不应被 R6 拦，也不应在 evidence.jsonl 里记成 `purpose:"delivery"`。

做完把结果（截图或哪一步不对）发回项目里即可。
