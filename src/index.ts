import type { Hooks, PluginInput } from "@opencode-ai/plugin"

const UNPROXYABLE_COMMANDS = new Set([
  "cd", "source", ".", "export", "alias", "unset", "set", "shopt", "eval", "exec",
])

export type OperatorSegment = { text: string; isSeparator: boolean }

export type SnipConfig = {
  skip?: string[]
  only?: string[]
}

export function splitOnOperators(command: string): OperatorSegment[] {
  const result: OperatorSegment[] = []
  let current = ""
  let inSingleQuote = false
  let inDoubleQuote = false
  let dollarParenDepth = 0
  let backtickDepth = 0
  let i = 0

  while (i < command.length) {
    const char = command[i]

    // Track quotes (only outside $() — quotes inside $() are just data)
    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote
      current += char
      i++
      continue
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote
      current += char
      i++
      continue
    }

    // Track $(...) nesting — only when NOT inside quotes
    if (char === "$" && command[i + 1] === "(" && !inSingleQuote && !inDoubleQuote) {
      dollarParenDepth++
      current += "$("
      i += 2
      continue
    }

    if (char === ")" && dollarParenDepth > 0 && !inSingleQuote && !inDoubleQuote) {
      dollarParenDepth--
      current += ")"
      i++
      continue
    }

    // Track backtick depth — only when NOT inside quotes
    if (char === "`" && !inSingleQuote && !inDoubleQuote) {
      backtickDepth = backtickDepth === 0 ? 1 : 0
      current += "`"
      i++
      continue
    }

    // Only parse operators when outside quotes, $(), and backticks
    if (!inSingleQuote && !inDoubleQuote && dollarParenDepth === 0 && backtickDepth === 0) {
      let matched = false

      // Check for &&
      if (char === "&" && command[i + 1] === "&") {
        const trimmed = trimTrailingWs(current)
        const leadingWs = current.slice(trimmed.length)
        current = trimmed

        if (current) {
          result.push({ text: current, isSeparator: false })
          current = ""
        }

        let sep = leadingWs + "&&"
        i += 2
        const trailingWs = consumeWs(command, i)
        sep += trailingWs
        i += trailingWs.length

        result.push({ text: sep, isSeparator: true })
        matched = true
        continue
      }

      // Check for ||
      if (char === "|" && command[i + 1] === "|") {
        const trimmed = trimTrailingWs(current)
        const leadingWs = current.slice(trimmed.length)
        current = trimmed

        if (current) {
          result.push({ text: current, isSeparator: false })
          current = ""
        }

        let sep = leadingWs + "||"
        i += 2
        const trailingWs = consumeWs(command, i)
        sep += trailingWs
        i += trailingWs.length

        result.push({ text: sep, isSeparator: true })
        matched = true
        continue
      }

      // Check for ; (semicolon)
      if (char === ";") {
        const trimmed = trimTrailingWs(current)
        const leadingWs = current.slice(trimmed.length)
        current = trimmed

        if (current) {
          result.push({ text: current, isSeparator: false })
          current = ""
        }

        let sep = leadingWs + ";"
        i++
        const trailingWs = consumeWs(command, i)
        sep += trailingWs
        i += trailingWs.length

        result.push({ text: sep, isSeparator: true })
        matched = true
        continue
      }

      // Check for & (background operator — NOT redirection like >&)
      if (char === "&") {
        const prevChar = i > 0 ? command[i - 1] : " "
        if (prevChar === " " || prevChar === "\t") {
          const trimmed = trimTrailingWs(current)
          const leadingWs = current.slice(trimmed.length)
          current = trimmed

          if (current) {
            result.push({ text: current, isSeparator: false })
            current = ""
          }

          let sep = leadingWs + "&"
          i++
          if (command[i] === " " || command[i] === "\t") {
            sep += command[i]
            i++
          }

          result.push({ text: sep, isSeparator: true })
          matched = true
          continue
        }
      }

      if (!matched) {
        current += char
        i++
      }
    } else {
      // Inside quotes or $() or backtick — accumulate everything literally
      current += char
      i++
    }
  }

  if (current) {
    result.push({ text: current, isSeparator: false })
  }

  return result
}

function trimTrailingWs(s: string): string {
  let end = s.length
  while (end > 0 && (s[end - 1] === " " || s[end - 1] === "\t")) {
    end--
  }
  return s.slice(0, end)
}

function consumeWs(s: string, start: number): string {
  let j = start
  while (j < s.length && (s[j] === " " || s[j] === "\t")) {
    j++
  }
  return s.slice(start, j)
}

function extractEnvPrefix(command: string): string {
  let result = ""
  let pos = 0

  while (pos < command.length) {
    const eqIdx = command.indexOf("=", pos)
    if (eqIdx === -1) break

    const namePart = command.slice(pos, eqIdx)
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(namePart)) break

    let j = eqIdx + 1
    let dollarParenDepth = 0
    let backtickMode = false
    let inSQ = false
    let inDQ = false
    let operatorInSubst = false

    while (j < command.length) {
      const ch = command[j]

      if (ch === "'" && !inDQ && dollarParenDepth === 0 && !backtickMode) {
        inSQ = !inSQ
        j++
        continue
      }

      if (ch === '"' && !inSQ && dollarParenDepth === 0 && !backtickMode) {
        inDQ = !inDQ
        j++
        continue
      }

      if (inSQ || inDQ) {
        j++
        continue
      }

      if (ch === "$" && command[j + 1] === "(") {
        dollarParenDepth++
        j += 2
        continue
      }

      if (ch === ")" && dollarParenDepth > 0) {
        dollarParenDepth--
        j++
        continue
      }

      if (ch === "`") {
        backtickMode = !backtickMode
        j++
        continue
      }

      if (dollarParenDepth > 0 || backtickMode) {
        if (
          (ch === "&" && command[j + 1] === "&") ||
          (ch === "|" && command[j + 1] === "|") ||
          ch === ";"
        ) {
          operatorInSubst = true
        }
        j++
        continue
      }

      if (ch === " " || ch === "\t") break
      j++
    }

    if (operatorInSubst) break

    result += command.slice(pos, j)

    pos = j
    while (pos < command.length && (command[pos] === " " || command[pos] === "\t")) {
      result += command[pos]
      pos++
    }
  }

  return result
}

function findFirstPipe(command: string): number {
  let inSingleQuote = false
  let inDoubleQuote = false

  for (let i = 0; i < command.length; i++) {
    const char = command[i]

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote
    } else if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote
    } else if (char === '|' && !inSingleQuote && !inDoubleQuote) {
      if (command[i + 1] === '|' || (i > 0 && command[i - 1] === '|')) {
        i++
        continue
      }
      return i
    }
  }

  return -1
}

function snipCommand(command: string): string {
  const envPrefix = extractEnvPrefix(command)
  let bareCmd = command.slice(envPrefix.length).trim()
  if (!bareCmd) return command
  if (UNPROXYABLE_COMMANDS.has(bareCmd.split(/\s+/)[0])) return command
  if (bareCmd.startsWith("snip ")) {
    bareCmd = bareCmd.slice(5)
  }
  return `${envPrefix}snip ${bareCmd}`
}

function processSegment(segment: string, config: SnipConfig): string {
  const envPrefix = extractEnvPrefix(segment)
  let bareCmd = segment.slice(envPrefix.length).trim()
  if (!bareCmd) return segment

  const firstToken = bareCmd.split(/\s+/)[0]

  if (config.only && config.only.length > 0) {
    if (!config.only.includes(firstToken)) return segment
  } else if (config.skip && config.skip.length > 0) {
    if (config.skip.includes(firstToken)) return segment
  }

  return snipCommand(segment)
}

export function transformCommand(command: string, config: SnipConfig): string {
  if (findFirstPipe(command) !== -1) {
    const pipeIdx = findFirstPipe(command)
    const firstCmd = command.slice(0, pipeIdx).trimEnd()
    const rest = command.slice(pipeIdx)
    return processSegment(firstCmd, config) + ' ' + rest
  }

  const segments = splitOnOperators(command)

  if (segments.every((s) => !s.isSeparator)) {
    return processSegment(command, config)
  }

  return segments
    .map((segment) => segment.isSeparator ? segment.text : processSegment(segment.text, config))
    .join("")
}

export const toolExecuteBefore: NonNullable<Hooks["tool.execute.before"]> = async (input, output) => {
  if (input.tool !== "bash") return

  const command = output.args.command
  if (!command || typeof command !== "string") return

  output.args.command = transformCommand(command, {})
}

function buildConfig(options?: Record<string, unknown>): SnipConfig {
  const config: SnipConfig = {}
  if (options) {
    if (Array.isArray(options.skip)) {
      config.skip = options.skip.filter((s): s is string => typeof s === 'string')
    }
    if (Array.isArray(options.only)) {
      config.only = options.only.filter((s): s is string => typeof s === 'string')
    }
  }
  return config
}

type SnipPluginFactory = (input: PluginInput, options?: Record<string, unknown>) => Promise<Hooks>

export const SnipPlugin: SnipPluginFactory = async (input, options) => {
  const { $ } = input

  try {
    await $`sh -c 'command -v snip'`.quiet()
  } catch {
    console.warn("[snip] snip binary not found in PATH — plugin disabled")
    return {}
  }

  const config = buildConfig(options)

  return {
    "tool.execute.before": async (input, output) => {
      if (input.tool !== "bash") return
      const command = output.args.command
      if (!command || typeof command !== "string") return
      output.args.command = transformCommand(command, config)
    },
  }
}

export default SnipPlugin
