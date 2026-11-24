# 国内桌面 Agent 试装

「交付模式」的技能名为 `delivery-contract`。它让 Agent 先和你确认要交付什么、怎样验收，再开始实施。交付时，Agent 会逐条说明验收结果及证据。

| 客户端 | 技能导入与调用 | Python 校验 | 试用方式 |
|---|---|---|---|
| WorkBuddy | 待实机验证 | 待实机验证 | 有自定义技能入口时试装通用包 |
| 豆包桌面端 | 待实机验证 | 待实机验证 | 有自定义技能入口时试装。只有聊天入口时使用纯对话模板 |
| 其他桌面 Agent | 以实际版本为准 | 取决于工具权限 | 支持 Agent Skills 时试装通用包。支持读文件时可手动加载 |

## 试装通用技能包

1. 从 [GitHub Releases](https://github.com/znnw4m6k7k-dotcom/dsh-delivery/releases/latest) 下载 `delivery-contract-generic.zip`。也可以直接使用仓库中的 [通用技能目录](../agent-skill/delivery-contract/)。
2. 在你的客户端找「技能」「自定义技能」或「导入」一类入口。支持技能 ZIP 时上传安装包。支持目录时先解压，再选择整个 `delivery-contract/`。如果客户端文档指定技能根目录，把完整文件夹复制进去，使最终路径为 `<技能根目录>/delivery-contract/SKILL.md`。
3. 新开会话，在空白测试文件夹里输入下面的示例。用过后可以在客户端的技能列表里确认是否已启用。

> 请使用 delivery-contract，帮我做一个 CSV 销售对账工具。先问我按哪些字段匹配、金额误差怎么算、异常记录要怎么输出。把答案整理成编号的验收标准，等我确认后再开始。

**预期结果**是 Agent 先追问缺失信息并等待你确认验收标准。要验证脚本能力，可以继续让它在空白测试目录运行技能自带的 `delivery.py init` 和 `delivery.py status`。成功初始化后会建立 `.delivery/`，状态应显示 `contract_required`。脚本需要 Python 3、终端和项目目录权限。独立验收还需要宿主支持独立会话或子 Agent。

## 手动使用与反馈

- 客户端能读工作区文件时，解压后让它读取 `delivery-contract/SKILL.md` 和文中引用的相邻文件。
- 客户端只有聊天入口时，可以复制[纯对话模板](纯对话快速开始.md)，体验需求访谈和手工验收。
- 欢迎提交实测结果。请写明客户端名称和版本、系统、导入方式、能否调用、能否执行脚本，并附上去除私人信息的报错或截图。[反馈试装结果](https://github.com/znnw4m6k7k-dotcom/dsh-delivery/issues/new/choose)
