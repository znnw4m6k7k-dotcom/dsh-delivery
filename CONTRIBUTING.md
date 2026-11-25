# 参与贡献

欢迎提 Issue 和 PR。装不上、用着不顺、规则有漏洞，都可以直接开 Issue（有模板）。

## 本地跑测试
```sh
node --test "kit/tests/*.test.mjs"
python3 -m unittest discover -s claude-skill/tests
python3 -m unittest discover -s codex-skill/tests
python3 -m unittest discover -s agent-skill/tests
sh kit/tests/installer.test.sh          # Windows：kit\tests\installer.test.ps1
```
每个 PR 都会在 macOS、Windows、Linux 上自动跑一遍。

## 改动约定
- **不改 DSH 源码。** 只用技能、智能体预设、组合包 patch 和 Host 插件扩展。
- **Codex 版和通用版用脚本生成。** 改 `claude-skill/delivery-contract/` 后，运行 `python3 codex-skill/build.py` 和 `python3 codex-skill/build.py --generic`，一起提交生成结果。
- **DSH 的经验包模板也由脚本生成。** 改 `claude-skill/delivery-contract/assets/pack-template/` 后，运行 `python3 codex-skill/build.py --kit-template`，不要手改 `kit/skills/project-retro/pack-template/`。
- **DSH 版和 Claude 版的规则要同步。** 改了 `kit/skills/` 里的交付规则，记得在 `claude-skill/delivery-contract/` 里做对应修改，反过来也一样。`kit/tests/skill-sync.test.mjs` 会守住脚本里的共享常量（`PATTERNS`、`TYPES`、模板标记），正文措辞没有自动校验，改的时候要自己对照。
- **守卫规则要有测试。** 改 `kit/bundle/index.js` 时，在 `kit/tests/` 里加能复现问题的用例。
- **行业经验包不进仓库。** 经验包来自具体客户项目，即使脱敏过也留在用户自己电脑上。
- 文档和提示语用简体中文，写给不懂技术的使用者也能看懂。

## 发布
维护者打 `v*` 标签后，GitHub Actions 会自动生成安装包放到 Releases。
