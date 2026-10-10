import { atom, memberOf, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionMessage } from 'claude-code'

import type { ToolDetail } from '../types'

const PANE = 'tool-detail'
const PANE_TITLE = 'Tool call'
const FOLLOW_COMMAND = 'tool-pane-follow'
const OPEN_PANE_ACTION = 'diff:back'
const MAX_CHARS = 200_000
const MAX_GOAL_CHARS = 1_000
const ENVELOPE_KEYS = ['agentId', 'requestMeta', 'consent']
const SQL_KEYS = ['query', 'sql']
const HIGHLIGHT_BACKGROUNDS = { dark: '#3b4252', light: '#dde3ec' }

const selected = atom({ plugin: 'unclutter', key: 'selected' } as const, null)
const followOverride = atom({ plugin: 'unclutter', key: 'followOverride' } as const, null)
const inputs = atom({ plugin: 'unclutter', key: 'inputs' } as const, '')
const outputs = atom({ plugin: 'unclutter', key: 'outputs' } as const, '')
const goals = atom({ plugin: 'unclutter', key: 'goals' } as const, '')
const highlighted = atom({ plugin: 'unclutter', key: 'highlighted' } as const, false)
const shortcutHolder = atom({ plugin: 'unclutter', key: 'shortcutHolder' } as const, false)
const shortcutHolderId = atom({ plugin: 'unclutter', key: 'shortcutHolderId' } as const, null)

const clip = (text: string, max = MAX_CHARS): string =>
  text.length > max ? `${text.slice(0, max)}\n... (${text.length - max} more characters)` : text

const stringify = (value: unknown): string => {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

const textOf = (output: unknown): string => {
  if (typeof output === 'string') return output
  if (output !== null && typeof output === 'object') {
    const record = output as Record<string, unknown>
    if (Array.isArray(record.content)) {
      const texts = record.content
        .map(block => (block as { text?: unknown }).text)
        .filter((text): text is string => typeof text === 'string')
      if (texts.length > 0) return texts.join('\n')
    }
    if (typeof record.stdout === 'string' || typeof record.stderr === 'string') {
      return [record.stdout, record.stderr].filter(Boolean).join('\n')
    }
  }
  return stringify(output)
}

const parseNestedJson = (value: unknown): unknown => {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!/^[[{]/.test(trimmed)) return value
    try {
      return parseNestedJson(JSON.parse(trimmed))
    } catch {
      return value
    }
  }
  if (Array.isArray(value)) return value.map(parseNestedJson)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, parseNestedJson(inner)]))
  }
  return value
}

type CodeBlock = { label?: string; source: string; language?: string; path?: string; format?: 'diff' }

type FileEdit = { old_string: string; new_string: string }

const linesOf = (text: string): string[] => (text === '' ? [] : text.split('\n'))

const unifiedDiff = ({ old_string, new_string }: FileEdit): string => {
  const removed = linesOf(old_string)
  const added = linesOf(new_string)
  return [
    `@@ -1,${removed.length} +1,${added.length} @@`,
    ...removed.map(line => `-${line}`),
    ...added.map(line => `+${line}`),
  ].join('\n')
}

const isFileEdit = (value: unknown): value is FileEdit =>
  value !== null &&
  typeof value === 'object' &&
  typeof (value as FileEdit).old_string === 'string' &&
  typeof (value as FileEdit).new_string === 'string'

const fileEditsOf = (input: Record<string, unknown>): FileEdit[] => {
  if (isFileEdit(input)) return [input]
  return Array.isArray(input.edits) ? input.edits.filter(isFileEdit) : []
}

const writtenContentOf = (input: Record<string, unknown>): string | undefined => {
  if (typeof input.content === 'string') return input.content
  if (typeof input.new_source === 'string') return input.new_source
  return undefined
}

const filePathOf = (input: Record<string, unknown>): string | undefined => {
  const path = input.file_path ?? input.notebook_path
  return typeof path === 'string' ? path : undefined
}

const WRITE_KEYS = ['old_string', 'new_string', 'edits', 'content', 'new_source']

const outputBlock = (tool: string, output: string, input: Record<string, unknown>): CodeBlock => {
  const parsed = parseNestedJson(output)
  if (typeof parsed !== 'string') return { source: JSON.stringify(parsed, null, 2), language: 'json' }
  if (tool === 'Read' && typeof input.file_path === 'string') return { source: output, path: input.file_path }
  return { source: output }
}

const inputBlocks = (tool: string, input: Record<string, unknown>): CodeBlock[] => {
  const blocks: CodeBlock[] = []
  const rest: Record<string, unknown> = {}
  const path = filePathOf(input)
  const edits = fileEditsOf(input)
  const writtenContent = writtenContentOf(input)
  edits.forEach((edit, index) =>
    blocks.push({
      label: edits.length > 1 ? `${path ?? 'edit'} (${index + 1}/${edits.length})` : path,
      source: unifiedDiff(edit),
      path,
      format: 'diff',
    }),
  )
  if (edits.length === 0 && writtenContent !== undefined) {
    blocks.push({ label: path, source: writtenContent, path, language: path ? undefined : 'python' })
  }
  const isWrite = blocks.length > 0
  for (const [key, value] of Object.entries(input)) {
    if (isWrite && (WRITE_KEYS.includes(key) || value === path)) continue
    if (tool === 'Bash' && key === 'command' && typeof value === 'string') {
      blocks.push({ label: key, source: value, language: 'bash' })
    } else if (SQL_KEYS.includes(key) && typeof value === 'string') {
      blocks.push({ label: key, source: value, language: 'sql' })
    } else if (key !== 'description') {
      rest[key] = value
    }
  }
  if (Object.keys(rest).length > 0) {
    blocks.push({
      label: blocks.length > 0 ? 'other' : undefined,
      source: JSON.stringify(parseNestedJson(rest), null, 2),
      language: 'json',
    })
  }
  return blocks
}

const parseInput = (input: string): Record<string, unknown> => {
  try {
    const parsed: unknown = JSON.parse(input)
    return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`

const summarize = (text: string, input?: unknown): string => {
  const record = input !== null && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  const edits = fileEditsOf(record)
  if (edits.length > 0) {
    const added = edits.reduce((sum, edit) => sum + linesOf(edit.new_string).length, 0)
    const removed = edits.reduce((sum, edit) => sum + linesOf(edit.old_string).length, 0)
    return `+${added} -${removed} lines`
  }
  const writtenContent = writtenContentOf(record)
  if (writtenContent !== undefined) return `wrote ${plural(linesOf(writtenContent).length, 'line')}`
  const lines = linesOf(text).length
  return lines === 0 ? 'no output' : plural(lines, 'line')
}

const displayToolName = (tool: string): string => {
  const [, server, name] = tool.match(/^mcp__(.+?)__(.+)$/) ?? []
  return server && name ? `${server} - ${name} (MCP)` : tool
}

const argumentsPreview = (input: unknown): string => {
  if (input === null || typeof input !== 'object') return stringify(input)
  return Object.entries(input as Record<string, unknown>)
    .filter(([key]) => !WRITE_KEYS.includes(key))
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join(', ')
}

const toolInput = (e: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(e).filter(([key]) => key !== 'tool' && key !== 'tool_use_id' && !ENVELOPE_KEYS.includes(key)),
  )

const withoutCodeBlocks = (markdown: string): string =>
  markdown
    .replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1[`~]*[ \t]*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

const goalFrom = (messages: readonly SessionMessage[], toolUseId: string, input: Record<string, unknown>): string => {
  if (typeof input.description === 'string' && input.description.trim()) return input.description.trim()

  const ownIndex = messages.findIndex(message => message.toolUses.some(use => use.tool_use_id === toolUseId))
  for (let index = ownIndex === -1 ? messages.length - 1 : ownIndex; index >= 0; index--) {
    const message = messages[index]
    const prose = message === undefined ? '' : withoutCodeBlocks(message.text)
    if (message === undefined || !prose) continue
    const isPrompt = message.role === 'user' && (message.toolResults?.length ?? 0) === 0
    if (message.role === 'assistant' || isPrompt) return clip(prose, MAX_GOAL_CHARS)
  }
  return ''
}

const goalOf = async ($: EngineInterface, toolUseId: string, input: Record<string, unknown>): Promise<string> =>
  goalFrom(await $.session.messages().catch(() => []), toolUseId, input)

const moveShortcutHolder = async ($: EngineInterface, id: string): Promise<void> => {
  const previous = await read($, shortcutHolderId)
  if (previous === id) return
  if (previous !== null) await update($, memberOf(shortcutHolder, { requestId: previous }), () => false)
  await update($, memberOf(shortcutHolder, { requestId: id }), () => true)
  await update($, shortcutHolderId, () => id)
}

const showDetail = async ($: EngineInterface, detail: ToolDetail): Promise<void> => {
  const previous = await read($, selected)
  if (previous !== null && previous.id !== detail.id) {
    await update($, memberOf(highlighted, { requestId: previous.id }), () => false)
  }
  await update($, memberOf(highlighted, { requestId: detail.id }), () => true)
  await update($, selected, () => detail)
  await moveShortcutHolder($, detail.id)
}

const stepSelection = async ($: EngineInterface, direction: 1 | -1, expandedTools: ReadonlySet<string>): Promise<void> => {
  const messages = await $.session.messages().catch(() => [])
  const calls = messages.flatMap(message => message.toolUses).filter(call => !expandedTools.has(call.tool))
  if (calls.length === 0) return

  const current = await read($, selected)
  const currentIndex = calls.findIndex(call => call.tool_use_id === current?.id)
  const nextIndex =
    currentIndex === -1
      ? direction === 1 ? 0 : calls.length - 1
      : Math.min(calls.length - 1, Math.max(0, currentIndex + direction))
  const call = calls[nextIndex]
  if (call === undefined || call.tool_use_id === current?.id) return

  const id = call.tool_use_id
  const recordedOutput = await read($, memberOf(outputs, { requestId: id }))
  const hasResult = call.text !== undefined || call.result !== undefined
  await showDetail($, {
    id,
    tool: call.tool,
    goal: goalFrom(messages, id, call.input),
    input: clip(stringify(call.input)),
    output: recordedOutput || clip(call.text ?? textOf(call.result)),
    isError: call.isError === true,
    isRunning: !hasResult && !recordedOutput,
  })
  await $.ui.scroll({ to: { requestId: id }, block: 'center' }).catch(() => undefined)
}

const isFollowing = async ($: EngineInterface, followByDefault: boolean): Promise<boolean> =>
  (await read($, followOverride)) ?? followByDefault

const highlightBackgroundOf = async (
  $: EngineInterface,
  e: { requestId: string },
  configuredColor: string,
): Promise<string | undefined> => {
  if (!(await read($, memberOf(highlighted, e)))) return undefined
  if (configuredColor && configuredColor !== 'auto') return configuredColor
  const rows = await $.config.list().catch(() => [])
  const theme = String(rows.find(row => row.key === 'theme')?.value ?? '')
  return theme.includes('light') ? HIGHLIGHT_BACKGROUNDS.light : HIGHLIGHT_BACKGROUNDS.dark
}

type RowState = { background: string | undefined; isShortcutHolder: boolean }

const rowStateOf = async ($: EngineInterface, e: { requestId: string }, configuredColor: string): Promise<RowState> => ({
  background: await highlightBackgroundOf($, e, configuredColor),
  isShortcutHolder: await read($, memberOf(shortcutHolder, e)),
})

const collapsedResult = (
  $: EngineInterface,
  e: Parameters<EngineInterface['ui']['resolve']>[0] & { requestId: string },
  call: { tool: string; output?: unknown; isErrored: boolean; input?: unknown },
  { background, isShortcutHolder }: RowState,
) => {
  const { Box, Button, Text } = $.ui.resolve(e)
  const text = textOf(call.output)
  const firstLine = text.split('\n').find(line => line.trim().length > 0) ?? ''
  const isHighlighted = background !== undefined

  const open = async () => {
    const recordedInput = await read($, memberOf(inputs, e))
    const recordedOutput = await read($, memberOf(outputs, e))
    const detail: ToolDetail = {
      id: e.requestId,
      tool: call.tool,
      goal: await read($, memberOf(goals, e)),
      input: recordedInput || clip(stringify(call.input)),
      output: recordedOutput || clip(text),
      isError: call.isErrored,
      isRunning: false,
    }
    await showDetail($, detail)
    await $.ui.open({ id: PANE, title: PANE_TITLE, ...(isShortcutHolder ? { focus: true as const } : {}) })
  }

  return (
    <Box backgroundColor={background}>
      {isHighlighted ? <Text color="suggestion">{'▎ ⎿  '}</Text> : <Text dimColor>{'  ⎿  '}</Text>}
      {call.isErrored ? (
        <Text color="red" wrap="truncate-end">
          error: {firstLine}{' '}
        </Text>
      ) : (
        <Text dimColor>{summarize(text, call.input)} </Text>
      )}
      <Button
        key="details"
        label="details"
        plain
        dimColor={!isHighlighted}
        onPress={open}
        {...(isShortcutHolder ? { action: OPEN_PANE_ACTION } : {})}
      />
    </Box>
  )
}

export const register: Register = (on, options) => {
  const followByDefault = options.followLatest !== false
  const highlightColor = String(options.highlightColor ?? 'auto').trim()
  const expandedTools = new Set(
    String(options.expandedTools ?? '')
      .split(',')
      .map(name => name.trim())
      .filter(Boolean),
  )

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: FOLLOW_COMMAND,
      description: 'Toggle whether the tool call pane follows the latest tool call',
    })
    return next(e)
  })

  on('command.run', { command: FOLLOW_COMMAND }, async $ => {
    const isNowFollowing = !(await isFollowing($, followByDefault))
    await update($, followOverride, () => isNowFollowing)
    return { text: `Tool call pane ${isNowFollowing ? 'follows the latest call' : 'stays on the call it shows'}.` }
  })

  on('tool.call', async ($, e, next) => {
    const id = e.tool_use_id
    const input = toolInput(e as unknown as Record<string, unknown>)
    const inputText = clip(stringify(input))
    const goal = await goalOf($, id, input)
    await update($, memberOf(inputs, { requestId: id }), () => inputText)
    await update($, memberOf(goals, { requestId: id }), () => goal)

    const isTracked = e.agentId === undefined && (await isFollowing($, followByDefault))
    if (isTracked) {
      await showDetail($, {
        id,
        tool: e.tool,
        goal,
        input: inputText,
        output: '',
        isError: false,
        isRunning: true,
      })
    }

    const ran = await next(e)
    const output = clip(ran.text ?? ran.deny ?? '')
    const isError = ran.isError === true || ran.deny !== undefined
    await update($, memberOf(outputs, { requestId: id }), () => output)
    await update($, selected, current =>
      current?.id === id ? { ...current, output, isError, isRunning: false } : current,
    )
    const isCollapsedOnMainThread = e.agentId === undefined && !expandedTools.has(e.tool)
    if (isCollapsedOnMainThread && (await read($, selected)) === null) await moveShortcutHolder($, id)
    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const isCollapsible = !e.props.isRunning && e.props.output !== undefined && !expandedTools.has(e.props.tool)
    if (!isCollapsible) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const color = e.props.isErrored ? 'red' : 'green'
    const rowState = await rowStateOf($, e, highlightColor)

    return (
      <Box flexDirection="column" backgroundColor={rowState.background}>
        <Text wrap="truncate-end">
          <Text color={color}>⏺ </Text>
          <Text bold>{displayToolName(e.props.tool)}</Text>
          <Text dimColor>({argumentsPreview(e.props.input)})</Text>
        </Text>
        {collapsedResult($, e, e.props, rowState)}
      </Box>
    )
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (expandedTools.has(e.props.tool)) return next(e)
    return collapsedResult($, e, e.props, await rowStateOf($, e, highlightColor))
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Code, Text } = $.ui.resolve(e)
    const detail = await read($, selected)
    const isFollowingNow = await isFollowing($, followByDefault)

    const header = (
      <Box>
        <Button
          key="follow"
          hotkey="f"
          plain
          dimColor
          label={isFollowingNow ? 'following latest (f)' : 'pinned (f)'}
          onPress={() => update($, followOverride, override => !(override ?? followByDefault))}
        />
        <Text>  </Text>
        <Button key="previous" hotkey="k" plain dimColor label="prev (k)" onPress={() => stepSelection($, -1, expandedTools)} />
        <Text>  </Text>
        <Button key="next" hotkey="j" plain dimColor label="next (j)" onPress={() => stepSelection($, 1, expandedTools)} />
        <Text>  </Text>
        <Button key="close" label="close" plain dimColor role="dismiss" onPress={() => $.ui.close({ id: PANE })} />
      </Box>
    )

    if (detail === null) {
      return (
        <Box flexDirection="column">
          {header}
          <Text dimColor>Press "details" on a tool call to see it here.</Text>
        </Box>
      )
    }

    const input = parseInput(detail.input)
    const code = (block: CodeBlock) => (
      <Box flexDirection="column">
        {block.label !== undefined && <Text dimColor>{block.label}</Text>}
        <Code source={block.source} language={block.language} path={block.path} format={block.format} />
      </Box>
    )

    return (
      <Box flexDirection="column">
        {header}
        <Text> </Text>
        <Text bold>{displayToolName(detail.tool)}</Text>
        <Text> </Text>
        <Text bold dimColor>Goal</Text>
        <Text>{detail.goal || '(none recorded)'}</Text>
        <Text> </Text>
        <Text bold dimColor>Input</Text>
        {detail.input ? inputBlocks(detail.tool, input).map(code) : <Text dimColor>(not recorded)</Text>}
        <Text> </Text>
        <Text bold dimColor>{detail.isError ? 'Error' : 'Output'}</Text>
        {detail.isRunning ? (
          <Text dimColor>running...</Text>
        ) : detail.isError ? (
          <Text color="red">{detail.output}</Text>
        ) : detail.output ? (
          code(outputBlock(detail.tool, detail.output, input))
        ) : (
          <Text dimColor>(empty)</Text>
        )}
      </Box>
    )
  })
}
