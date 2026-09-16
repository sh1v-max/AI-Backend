import chalk from 'chalk'

// Force colors on regardless of whether stdout is detected as a real TTY —
// chalk auto-disables color when output is piped/redirected (e.g. into a
// log file), but we always want these logs readable, including then.
chalk.level = 1

// Two color themes — one per pipeline — so scrolling through mixed traffic
// (uploads and chats happening close together) is easy to tell apart at a
// glance, not just by reading the text.
const THEMES = {
  upload: chalk.cyan,
  chat: chalk.magenta,
}

type Pipeline = keyof typeof THEMES

export function pipelineStart(pipeline: Pipeline, title: string) {
  const color = THEMES[pipeline]
  const line = '─'.repeat(20)
  console.log(`\n${color(line)} ${color.bold(title)} ${color(line)}`)
}

export function pipelineEnd(pipeline: Pipeline, totalMs: number) {
  const color = THEMES[pipeline]
  console.log(chalk.green.bold(`✓ Total request time: ${totalMs}ms`))
  console.log(color('─'.repeat(60)))
}

export function step(pipeline: Pipeline, n: number, total: number, label: string) {
  const color = THEMES[pipeline]
  console.log(color.bold(`[${n}/${total}]`) + ' ' + label)
}

export function detail(text: string) {
  console.log(chalk.gray(`      ${text}`))
}

export function timing(ms: number, extra?: string) {
  console.log(chalk.gray('      ') + chalk.yellow(`done in ${ms}ms`) + (extra ? chalk.gray(` — ${extra}`) : ''))
}

export function preview(label: string, text: string, maxLen = 80) {
  const trimmed = text.slice(0, maxLen).replace(/\n/g, ' ')
  const suffix = text.length > maxLen ? '…' : ''
  console.log(chalk.gray(`        ${label}: `) + chalk.white(`"${trimmed}${suffix}"`))
}

export function rejected(reason: string) {
  console.log(chalk.red.bold('✗ Rejected: ') + chalk.red(reason))
}

export function notFound(reason: string) {
  console.log(chalk.red.bold('✗ ') + chalk.red(reason))
}
