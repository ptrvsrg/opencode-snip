import { describe, it, expect, beforeEach, vi } from "vitest"
import { toolExecuteBefore, SnipPlugin, transformCommand } from "./index"

describe("toolExecuteBefore", () => {
  let mockInput: { tool: string; sessionID: string; callID: string }
  let mockOutput: { args: { command: string } }

  beforeEach(() => {
    mockInput = { tool: "bash", sessionID: "s", callID: "c" }
    mockOutput = { args: { command: "" } }
  })

  it("should prefix simple command with snip", async () => {
    mockOutput.args.command = "go test ./..."
    await toolExecuteBefore(mockInput, mockOutput)
    expect(mockOutput.args.command).toBe("snip go test ./...")
  })

  it("should handle command with one env var prefix", async () => {
    mockOutput.args.command = "CGO_ENABLED=0 go test ./..."
    await toolExecuteBefore(mockInput, mockOutput)
    expect(mockOutput.args.command).toBe("CGO_ENABLED=0 snip go test ./...")
  })

  it("should handle command with multiple env var prefixes", async () => {
    mockOutput.args.command = "CGO_ENABLED=0 GOOS=linux go test ./..."
    await toolExecuteBefore(mockInput, mockOutput)
    expect(mockOutput.args.command).toBe("CGO_ENABLED=0 GOOS=linux snip go test ./...")
  })

  it("should handle command with &&", async () => {
    mockOutput.args.command = "go test && go build"
    await toolExecuteBefore(mockInput, mockOutput)
    expect(mockOutput.args.command).toBe("snip go test && snip go build")
  })

  it("should handle command with |", async () => {
    mockOutput.args.command = "git log | head"
    await toolExecuteBefore(mockInput, mockOutput)
    expect(mockOutput.args.command).toBe("snip git log | head")
  })

  it("should handle command with ;", async () => {
    mockOutput.args.command = "go test; go build"
    await toolExecuteBefore(mockInput, mockOutput)
    expect(mockOutput.args.command).toBe("snip go test; snip go build")
  })

  it("should handle command with ||", async () => {
    mockOutput.args.command = "test -f foo.txt || echo missing"
    await toolExecuteBefore(mockInput, mockOutput)
    expect(mockOutput.args.command).toBe("snip test -f foo.txt || snip echo missing")
  })

  it("should handle command with &", async () => {
    mockOutput.args.command = "sleep 1 & sleep 2 &"
    await toolExecuteBefore(mockInput, mockOutput)
    expect(mockOutput.args.command).toBe("snip sleep 1 & snip sleep 2 &")
  })

  it("should handle mixed operators", async () => {
    mockOutput.args.command = "go test && go build; go run"
    await toolExecuteBefore(mockInput, mockOutput)
    expect(mockOutput.args.command).toBe("snip go test && snip go build; snip go run")
  })

  it("should handle env vars with operators", async () => {
    mockOutput.args.command = "FOO=bar go test && go build"
    await toolExecuteBefore(mockInput, mockOutput)
    expect(mockOutput.args.command).toBe("FOO=bar snip go test && snip go build")
  })

  it("should not double prefix already prefixed command", async () => {
    mockOutput.args.command = "snip go test"
    await toolExecuteBefore(mockInput, mockOutput)
    expect(mockOutput.args.command).toBe("snip go test")
  })

  it("should not modify non-bash tool calls", async () => {
    mockInput.tool = "read"
    mockOutput.args.command = "go test"
    await toolExecuteBefore(mockInput, mockOutput)
    expect(mockOutput.args.command).toBe("go test")
  })

  describe("unproxyable shell builtins", () => {
    it("should skip cd", async () => {
      mockOutput.args.command = "cd /tmp"
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("cd /tmp")
    })

    it("should skip source", async () => {
      mockOutput.args.command = "source ~/.bashrc"
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("source ~/.bashrc")
    })

    it("should skip . (dot)", async () => {
      mockOutput.args.command = ". ./env.sh"
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe(". ./env.sh")
    })

    it("should skip export", async () => {
      mockOutput.args.command = "export FOO=bar"
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("export FOO=bar")
    })

    it("should skip alias", async () => {
      mockOutput.args.command = 'alias ll="ls -la"'
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe('alias ll="ls -la"')
    })

    it("should skip unset", async () => {
      mockOutput.args.command = "unset VAR"
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("unset VAR")
    })

    it("should skip export with env var prefix", async () => {
      mockOutput.args.command = "CGO_ENABLED=0 export FOO=bar"
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("CGO_ENABLED=0 export FOO=bar")
    })

    it("should skip cd but snip chained command", async () => {
      mockOutput.args.command = "cd /tmp && ls"
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("cd /tmp && snip ls")
    })
  })

  describe("redirections with &", () => {
    it("should not break 2>&1 redirection", async () => {
      mockOutput.args.command = "find / -name \"*.log\" 2>&1"
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("snip find / -name \"*.log\" 2>&1")
    })

    it("should not break 1>&2 redirection", async () => {
      mockOutput.args.command = "cmd 1>&2"
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("snip cmd 1>&2")
    })

    it("should handle 2>&1 with pipe", async () => {
      mockOutput.args.command = "find / -name \"*.log\" 2>&1 | grep error"
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("snip find / -name \"*.log\" 2>&1 | grep error")
    })

    it("should handle 2>&1 with chained commands", async () => {
      mockOutput.args.command = "cmd1 2>&1 && cmd2"
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("snip cmd1 2>&1 && snip cmd2")
    })
  })

  describe("command substitution in env vars (#22)", () => {
    it("should not snip inside $() substitution", async () => {
      mockOutput.args.command = "VAR1=$(echo hello) go test"
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("VAR1=$(echo hello) snip go test")
    })

    it("should handle multiple env vars with $()", async () => {
      mockOutput.args.command = "A=$(date +%s) B=2 cmd"
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("A=$(date +%s) B=2 snip cmd")
    })

    it("should handle spaces inside $() substitution", async () => {
      mockOutput.args.command = "VAR=$(echo a b c) cmd"
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("VAR=$(echo a b c) snip cmd")
    })

    it("should handle backtick substitution", async () => {
      mockOutput.args.command = "V=`id -u` cmd"
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("V=`id -u` snip cmd")
    })

    it("should handle double quotes inside $()", async () => {
      mockOutput.args.command = 'VAR=$(echo "hello world") cmd'
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe('VAR=$(echo "hello world") snip cmd')
    })

    it("should handle single quotes inside $()", async () => {
      mockOutput.args.command = "VAR=$(echo 'hello world') cmd"
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("VAR=$(echo 'hello world') snip cmd")
    })

    it("should handle nested $() substitution", async () => {
      mockOutput.args.command = "VAR=$(echo $(date)) cmd"
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("VAR=$(echo $(date)) snip cmd")
    })

    it("should handle backtick with env var and operator", async () => {
      mockOutput.args.command = "V=`id -u` echo hi && echo bye"
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("V=`id -u` snip echo hi && snip echo bye")
    })

    it("should handle mixed $() and simple env vars", async () => {
      mockOutput.args.command = "FOO=bar VAR=$(echo hello) GOOS=linux go test"
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("FOO=bar VAR=$(echo hello) GOOS=linux snip go test")
    })
  })

  describe("pipe expressions with quotes", () => {
    it("should not split pipes inside single quotes", async () => {
      mockOutput.args.command = "cat file.json | jq '.content | .text'"
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("snip cat file.json | jq '.content | .text'")
    })

    it("should not split pipes inside double quotes", async () => {
      mockOutput.args.command = 'cat file.json | jq ".content | .text"'
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe('snip cat file.json | jq ".content | .text"')
    })

    it("should handle jq with fromjson", async () => {
      mockOutput.args.command = "cat file.json | jq '.content[0].text | fromjson'"
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("snip cat file.json | jq '.content[0].text | fromjson'")
    })

    it("should handle multiple pipes in jq", async () => {
      mockOutput.args.command = "cat file.json | jq '.a | .b | .c'"
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("snip cat file.json | jq '.a | .b | .c'")
    })

    it("should handle pipe with || operator", async () => {
      mockOutput.args.command = "cmd1 || cmd2"
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("snip cmd1 || snip cmd2")
    })

    it("should handle mixed quotes and pipes", async () => {
      mockOutput.args.command = 'echo "hello | world" | cat'
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe('snip echo "hello | world" | cat')
    })
  })

  describe("quote- and $()-aware operator splitting (#23)", () => {
    it("should not split ; inside double quotes", async () => {
      mockOutput.args.command = 'ssh root@host "echo hello; echo world"'
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe('snip ssh root@host "echo hello; echo world"')
    })

    it("should split && outside quotes but not ; inside quotes", async () => {
      mockOutput.args.command = 'ssh root@host "echo hello; echo world" && echo done'
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe('snip ssh root@host "echo hello; echo world" && snip echo done')
    })

    it("should not split && inside bash -c double quotes", async () => {
      mockOutput.args.command = 'bash -c "cd /app && npm test"'
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe('snip bash -c "cd /app && npm test"')
    })

    it("should not split && inside docker exec bash -c double quotes", async () => {
      mockOutput.args.command = 'docker exec c bash -c "cd /app && npm test"'
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe('snip docker exec c bash -c "cd /app && npm test"')
    })

    it("should not split ; inside bash -c for-loop double quotes", async () => {
      mockOutput.args.command = 'bash -c "for i in 1 2 3; do echo $i; done"'
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe('snip bash -c "for i in 1 2 3; do echo $i; done"')
    })

    it("should not split && inside $()", async () => {
      mockOutput.args.command = "VAR=$(cmd1 && cmd2) main"
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("snip VAR=$(cmd1 && cmd2) main")
    })

    it("should not split || inside $()", async () => {
      mockOutput.args.command = "result=$(cmd1 || fallback) report"
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("snip result=$(cmd1 || fallback) report")
    })

    it("should split && || ; outside quotes into separate payloads", async () => {
      mockOutput.args.command = "cmd1 && cmd2 || cmd3"
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("snip cmd1 && snip cmd2 || snip cmd3")
    })

    it("should split ; chained commands", async () => {
      mockOutput.args.command = "cmd1; cmd2; cmd3"
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("snip cmd1; snip cmd2; snip cmd3")
    })

    it("should not split && inside backtick command substitution", async () => {
      mockOutput.args.command = "V=`cmd1 && cmd2` main"
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("snip V=`cmd1 && cmd2` main")
    })

    it("should split && outside single quotes but not ; inside them", async () => {
      mockOutput.args.command = "echo 'hello; world' && echo done"
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("snip echo 'hello; world' && snip echo done")
    })

    it("should handle nested $() with operators", async () => {
      mockOutput.args.command = "x=$(echo $(cmd1 && cmd2)) outer && cmd3"
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("snip x=$(echo $(cmd1 && cmd2)) outer && snip cmd3")
    })
  })
})

describe("transformCommand", () => {
  it("should skip commands listed in skip", () => {
    expect(transformCommand("git status", { skip: ["git"] })).toBe("git status")
  })

  it("should proxy commands listed in only", () => {
    expect(transformCommand("go test", { only: ["go"] })).toBe("snip go test")
  })

  it("should leave commands outside only unchanged", () => {
    expect(transformCommand("ls -la", { only: ["go"] })).toBe("ls -la")
  })

  it("should proxy all proxyable commands with default config", () => {
    expect(transformCommand("go test", {})).toBe("snip go test")
  })

  it("should apply skip per operator-separated segment", () => {
    expect(transformCommand("cd /tmp && git status && go test", { skip: ["git"] })).toBe(
      "cd /tmp && git status && snip go test",
    )
  })

  it("should let only take precedence over skip", () => {
    expect(transformCommand("go test", { only: ["go"], skip: ["go"] })).toBe("snip go test")
    expect(transformCommand("git status", { only: ["go"], skip: ["git"] })).toBe("git status")
  })

  it("should match first token after env prefixes", () => {
    expect(transformCommand("CGO_ENABLED=0 git status", { skip: ["git"] })).toBe(
      "CGO_ENABLED=0 git status",
    )
  })
})

describe("SnipPlugin", () => {
  it("should return {} when snip is not found", async () => {
    // $ is a tagged template literal function — mock it to reject for detection
    const mockDollar = vi.fn((_template: TemplateStringsArray) => ({
      quiet: () => Promise.reject(new Error("command not found")),
    }))

    const hooks = await SnipPlugin({ $: mockDollar } as any)
    expect(hooks).toEqual({})
  })

  it("should return hooks with tool.execute.before when snip is found", async () => {
    const mockDollar = vi.fn((_template: TemplateStringsArray) => ({
      quiet: () => Promise.resolve({ exitCode: 0 }),
    }))

    const hooks = await SnipPlugin({ $: mockDollar } as any)
    expect(hooks["tool.execute.before"]).toBeTypeOf("function")
  })

  it("should bind skip options into the tool.execute.before hook", async () => {
    const mockDollar = vi.fn((_template: TemplateStringsArray) => ({
      quiet: () => Promise.resolve({ exitCode: 0 }),
    }))
    const hooks = await SnipPlugin({ $: mockDollar } as any, { skip: ["git"] })
    const hook = hooks["tool.execute.before"]
    expect(hook).toBeTypeOf("function")

    const output = { args: { command: "git status && go test" } }
    await hook?.({ tool: "bash", sessionID: "s", callID: "c" }, output)

    expect(output.args.command).toBe("git status && snip go test")
  })

  it("should ignore malformed options", async () => {
    const mockDollar = vi.fn((_template: TemplateStringsArray) => ({
      quiet: () => Promise.resolve({ exitCode: 0 }),
    }))
    const hooks = await SnipPlugin({ $: mockDollar } as any, { skip: 42 })
    const hook = hooks["tool.execute.before"]
    expect(hook).toBeTypeOf("function")

    const output = { args: { command: "git status" } }
    await hook?.({ tool: "bash", sessionID: "s", callID: "c" }, output)

    expect(output.args.command).toBe("snip git status")
  })
})
