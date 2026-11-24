# Delivery Contract

[简体中文](README.md) · [Downloads](https://github.com/znnw4m6k7k-dotcom/dsh-delivery/releases/latest) · [Report an issue](https://github.com/znnw4m6k7k-dotcom/dsh-delivery/issues/new/choose)

Delivery Contract helps an AI agent agree on acceptance criteria before starting a project, then report what it delivered and what it verified. Use it for software, proposals, research, and financial models.

## Install

| Host | Package and setup |
|---|---|
| DeepSeek Harness on macOS or Windows | Download `dsh-delivery-kit.zip` from [Releases](https://github.com/znnw4m6k7k-dotcom/dsh-delivery/releases/latest). Extract it, run `Install-Mac.command` or `Install-Windows.bat`, and restart DSH. Open the **交付** preset and run `/delivery-doctor`. |
| Claude web or desktop | Upload `delivery-contract-claude.zip` in Settings → Capabilities → Skills when custom skills are available. |
| Claude Code | Extract the Claude ZIP under `~/.claude/skills/`, or use the online installer with the `claude` target. |
| Codex | Use `delivery-contract-codex.zip` in a skill directory scanned by Codex, such as the project's `.agents/skills/`, or use the online installer with the `codex` target. |
| Cursor, GitHub Copilot, Gemini CLI, OpenCode, Windsurf, Devin Local, or another Agent Skills host | Download `delivery-contract-generic.zip` or copy [the complete `agent-skill/delivery-contract/` folder](agent-skill/delivery-contract/) from **Code → Download ZIP**. Put it in your host's skill root so the final path is `<skills-root>/delivery-contract/SKILL.md`. |
| Chat-only assistant | Copy the starter prompt below. |

For per-host directories and the macOS, Linux, and Windows online commands, see the [installation table and commands](README.md#安装其他-agent). If the latest release does not yet include the generic ZIP, use the source folder. Script-based verification requires Python 3, terminal access, and project file permissions. Model usage is billed through your host if applicable.

## Try it

Reload skills or start a new session. Ask: “Use delivery-contract to build a CSV sales summary tool. Ask me about inputs and outputs, and let me confirm the acceptance criteria before you implement it.”

If your assistant works only in chat, paste this first:

> Use a delivery contract for this task. Ask what outcome I need, propose numbered and verifiable acceptance criteria, and wait for my confirmation. Plan and deliver the agreed work, then check each criterion against available evidence. Mark unverified items and say whether the review was independent. Offer a retrospective after I approve the delivery.

The workflow follows the language of the request. Independent review depends on the host's capabilities. Update by reinstalling, and uninstall by removing the installed `delivery-contract/` folder or removing the skill in your client.

[MIT License](LICENSE) · [Security](SECURITY.md) · [Contributing](CONTRIBUTING.md)
