#!/usr/bin/env node
// 交付工作台命令行：
//   node workbench/cli.mjs [项目目录]          生成 .delivery/workbench.html 并打印路径
//   node workbench/cli.mjs [项目目录] --json   打印汇总 JSON
//   node workbench/cli.mjs [项目目录] --out <文件>
import fs from 'node:fs'
import path from 'node:path'
import { readWorkbench } from './state.mjs'
import { renderWorkbench } from './render.mjs'

const args = process.argv.slice(2)
let json = false, out, dir
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--json') json = true
  else if (args[i] === '--out') out = args[++i]
  else if (!dir) dir = args[i]
}
dir ??= process.cwd()

const s = readWorkbench(dir)
if (json) {
  process.stdout.write(JSON.stringify(s, null, 2) + '\n')
  process.exit(s.found ? 0 : 1)
}
if (!s.found) {
  console.error(`没有找到 .delivery/：${s.start}`)
  process.exit(1)
}
const file = out ? path.resolve(out) : path.join(s.root, '.delivery', 'workbench.html')
fs.writeFileSync(file, renderWorkbench(s))
console.log(file)
