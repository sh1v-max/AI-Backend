// Tagged console logging for tracing the app's data flow in devtools.
// Filter the console by "[DocMind:" (or a specific scope, e.g. "[DocMind:chat]")
// to isolate one area while debugging.
const ENABLED = true

function tag(scope: string) {
  return `%c[DocMind:${scope}]`
}

const STYLE_INFO = 'color:#16a34a;font-weight:600'
const STYLE_WARN = 'color:#d97706;font-weight:600'
const STYLE_ERROR = 'color:#dc2626;font-weight:600'

export const log = {
  info(scope: string, ...args: unknown[]) {
    if (ENABLED) console.log(tag(scope), STYLE_INFO, ...args)
  },
  warn(scope: string, ...args: unknown[]) {
    if (ENABLED) console.warn(tag(scope), STYLE_WARN, ...args)
  },
  error(scope: string, ...args: unknown[]) {
    if (ENABLED) console.error(tag(scope), STYLE_ERROR, ...args)
  },
}
