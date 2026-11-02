# dsh-delivery

把 OmniAgent 的交付方法做进 DSH（0.2.1-rc.5）的插件包：交付预设、5 个技能、运行时守卫 delivery-guard，以及“行业经验学习”。

- `kit/`：可分发的安装包（`sh kit/install.sh` 安装，`sh kit/uninstall.sh` 卸载）。
- `kit/skills/`：5 个技能（唯一来源）。
- `kit/bundle/workbench/`：交付工作台，`node kit/bundle/workbench/cli.mjs <项目目录>` 生成 `.delivery/workbench.html`。
- `kit/tests/`：`node --test kit/tests/*.test.mjs`。
- `claude-skill/`：同一套交付方法的 **Claude 技能版**（omni-delivery），claude.ai 和 Claude Code 通用，见 `claude-skill/安装说明.md`；测试 `python3 -m unittest discover -s claude-skill/tests`。
- `docs/Mac验证清单.md`：只能在装了 DSH 的 Mac 上做的验证步骤。
- `docs/`：技术准则、交接说明、OmniAgent 分析资料。

约束：不改 DSH 源码，只用技能、预设和插件扩展；行业经验须本人确认后写入；不使用 DeepSeek 商标。
