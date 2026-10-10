import { expect, test } from 'claude-code/testing'
import type { RenderElement } from 'claude-code'

const MCP_RESULT = {
  tool_use_id: 'toolu_1',
  tool: 'mcp__clickhouse-dev__run_query',
  output: { content: [{ type: 'text', text: 'row 1\nrow 2' }], isError: false },
  isErrored: false,
}

const PANE = {
  title: 'tool detail',
  isFocused: false,
  bodyColumns: 60,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`collapses an MCP result and shows it in the pane on ${surface}`, async ($, on) => {
    on("ui.open", () => ({ value: { isPlaced: true } }))
    const row = await $.ui.mount({
      plugin: 'unclutter',
      surface,
      component: 'ToolResult',
      requestId: 'toolu_1',
      props: MCP_RESULT,
    })
    const drawn = JSON.stringify(await row.drawn())
    expect(drawn).toContain('2 lines')
    expect(drawn).not.toContain('row 2')

    await row.press({ key: 'details' })

    const pane = await $.ui.mount({
      plugin: 'unclutter',
      surface,
      component: 'Pane',
      requestId: 'tool-detail',
      props: PANE,
    })
    const detail = JSON.stringify(await pane.drawn())
    expect(detail).toContain('clickhouse-dev - run_query (MCP)')
    expect(detail).toContain('row 2')
  })
}

test('leaves tools on the full-view list alone', async ($, on) => {
  let isEngineDrawn = false
  on('ui.render', { component: 'ToolResult' }, ($, e) => {
    isEngineDrawn = true
    const { Text } = $.ui.resolve(e)
    return h(Text, {}, 'engine') as RenderElement
  })
  const row = await $.ui.mount({
    plugin: 'unclutter',
    surface: 'terminal',
    component: 'ToolResult',
    requestId: 'toolu_2',
    props: { tool_use_id: 'toolu_2', tool: 'ExitPlanMode', output: {}, isErrored: false },
  })
  expect(await row.find({ key: 'details' })).toBeUndefined()
  expect(isEngineDrawn).toBe(true)
})

test('collapses an Edit and shows it as a diff', async ($, on) => {
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const input = { file_path: '/repo/app.py', old_string: 'a = 1', new_string: 'a = 2\nb = 3' }
  const row = await $.ui.mount({
    plugin: 'unclutter',
    surface: 'terminal',
    component: 'ToolUse',
    requestId: 'toolu_edit',
    props: { tool_use_id: 'toolu_edit', tool: 'Edit', input, isRunning: false, isErrored: false, isInterrupted: false, output: {} },
  })
  const drawn = JSON.stringify(await row.drawn())
  expect(drawn).toContain('+2 -1 lines')
  expect(drawn).not.toContain('a = 2')

  await row.press({ key: 'details' })
  const pane = await $.ui.mount({
    plugin: 'unclutter',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'tool-detail',
    props: PANE,
  })
  const code = await pane.find({ type: 'Code' })
  expect(code?.props).toMatchObject({ format: 'diff', path: '/repo/app.py', source: '@@ -1,1 +1,2 @@\n-a = 1\n+a = 2\n+b = 3' })
})

test('collapses an MCP call drawn inline in an expanded group', async ($, on) => {
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const row = await $.ui.mount({
    plugin: 'unclutter',
    surface: 'terminal',
    component: 'ToolUse',
    requestId: 'toolu_3',
    props: {
      tool_use_id: 'toolu_3',
      tool: 'mcp__clickhouse-prd__run_query',
      input: { query: 'SELECT 1' },
      isRunning: false,
      isErrored: false,
      isInterrupted: false,
      output: { result: '{"rows": [[1]]}' },
    },
  })
  const drawn = JSON.stringify(await row.drawn())
  expect(drawn).toContain('clickhouse-prd - run_query (MCP)')
  expect(drawn).toContain('3 lines')

  await row.press({ key: 'details' })
  const pane = await $.ui.mount({
    plugin: 'unclutter',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'tool-detail',
    props: PANE,
  })
  const detail = JSON.stringify(await pane.drawn())
  expect(detail).toContain('SELECT 1')
  expect(detail).toContain('rows')
})


test('the pane follows the latest tool call with its goal', async ($, on) => {
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.messages', () => ({
    value: [{ role: 'user' as const, text: 'How many tables are there?', toolUses: [] }],
  }))
  on('tool.call', () => ({ result: { content: [{ type: 'text', text: '{"tables": 125}' }], isError: false }, text: '{"tables": 125}' }))

  await $.tool.call({ tool: 'mcp__clickhouse-prd__run_query', query: 'SELECT count() FROM system.tables' })

  const pane = await $.ui.mount({
    plugin: 'unclutter',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'tool-detail',
    props: PANE,
  })
  const detail = JSON.stringify(await pane.drawn())
  expect(detail).toContain('How many tables are there?')
  expect(detail).toContain('SELECT count() FROM system.tables')
  expect(detail).toContain('"language":"sql"')
  expect(detail).toContain('125')
  expect(detail).toContain('following latest')

  await pane.press({ key: 'follow' })
  await $.tool.call({ tool: 'mcp__clickhouse-prd__run_query', query: 'SELECT 2' })
  const pinned = JSON.stringify(await pane.drawn())
  expect(pinned).toContain('pinned')
  expect(pinned).not.toContain('SELECT 2')
})

test('the pane does not follow when followLatest is off', { options: { followLatest: false } }, async ($, on) => {
  on('tool.call', () => ({ result: 'ok', text: 'ok' }))
  await $.tool.call({ tool: 'mcp__clickhouse-prd__run_query', query: 'SELECT 1' })

  const pane = await $.ui.mount({
    plugin: 'unclutter',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'tool-detail',
    props: PANE,
  })
  const detail = JSON.stringify(await pane.drawn())
  expect(detail).toContain('pinned')
  expect(detail).not.toContain('SELECT 1')
})

test('the goal leaves out code blocks', async ($, on) => {
  on('session.messages', () => ({
    value: [
      { role: 'user' as const, text: 'Count the tables', toolUses: [] },
      {
        role: 'assistant' as const,
        text: 'Counting the tables in prd:\n\n```sql\nSELECT count() FROM system.tables\n```',
        toolUses: [{ tool_use_id: 'toolu_goal', tool: 'mcp__clickhouse-prd__run_query', input: {} }],
      },
    ],
  }))
  on('tool.call', () => ({ result: 'ok', text: 'ok' }))
  await $.tool.call({ tool: 'mcp__clickhouse-prd__run_query', tool_use_id: 'toolu_goal', query: 'SELECT count() FROM system.tables' })

  const pane = await $.ui.mount({
    plugin: 'unclutter',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'tool-detail',
    props: PANE,
  })
  const goal = (await pane.findAll({ type: 'Text' })).map(element => element.text)
  expect(goal).toContain('Counting the tables in prd:')
  expect(goal.join('\n')).not.toContain('```')
})

test('j and k walk the collapsed calls and highlight the shown one', async ($, on) => {
  const use = (id: string, query: string) => ({
    tool_use_id: id,
    tool: 'mcp__clickhouse-prd__run_query',
    input: { query },
    text: `result of ${query}`,
  })
  on('session.messages', () => ({
    value: [
      { role: 'user' as const, text: 'Check the tables', toolUses: [] },
      { role: 'assistant' as const, text: 'First query:', toolUses: [use('toolu_a', 'SELECT 1')] },
      { role: 'assistant' as const, text: 'Plan:', toolUses: [{ tool_use_id: 'toolu_plan', tool: 'ExitPlanMode', input: {} }] },
      { role: 'assistant' as const, text: 'Second query:', toolUses: [use('toolu_b', 'SELECT 2')] },
    ],
  }))

  const pane = await $.ui.mount({
    plugin: 'unclutter',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'tool-detail',
    props: PANE,
  })
  const rowFor = (id: string) =>
    $.ui.mount({
      plugin: 'unclutter',
      surface: 'terminal',
      component: 'ToolResult',
      requestId: id,
      props: { tool_use_id: id, tool: 'mcp__clickhouse-prd__run_query', output: 'ok', isErrored: false },
    })
  const rowA = await rowFor('toolu_a')
  const rowB = await rowFor('toolu_b')

  await pane.press({ key: 'next' })
  expect(JSON.stringify(await pane.drawn())).toContain('SELECT 1')
  expect(JSON.stringify(await rowA.drawn())).toContain('▎')
  expect(JSON.stringify(await rowA.drawn())).toContain('"backgroundColor":"#3b4252"')
  expect(JSON.stringify(await rowB.drawn())).not.toContain('▎')
  expect(JSON.stringify(await rowB.drawn())).not.toContain('backgroundColor')

  await pane.press({ key: 'next' })
  const second = JSON.stringify(await pane.drawn())
  expect(second).toContain('SELECT 2')
  expect(second).toContain('Second query:')
  expect(JSON.stringify(await rowA.drawn())).not.toContain('▎')
  expect(JSON.stringify(await rowB.drawn())).toContain('▎')

  await pane.press({ key: 'previous' })
  expect(JSON.stringify(await pane.drawn())).toContain('SELECT 1')
})

test('the shown row carries the open-pane shortcut and opens the pane focused', async ($, on) => {
  const opened: { id: string; focus?: true }[] = []
  on('ui.open', ($, e) => {
    opened.push({ id: e.id, focus: e.focus })
    return { value: { isPlaced: true } }
  })
  const rowFor = (id: string) =>
    $.ui.mount({
      plugin: 'unclutter',
      surface: 'terminal',
      component: 'ToolResult',
      requestId: id,
      props: { tool_use_id: id, tool: 'mcp__clickhouse-prd__run_query', output: 'ok', isErrored: false },
    })
  const rowA = await rowFor('toolu_a')
  const rowB = await rowFor('toolu_b')

  await rowA.press({ key: 'details' })
  expect((await rowA.find({ key: 'details' }))?.props).toMatchObject({ action: 'diff:back' })
  expect((await rowB.find({ key: 'details' }))?.props.action).toBeUndefined()

  await rowA.press({ key: 'details' })
  expect(opened).toEqual([{ id: 'tool-detail' }, { id: 'tool-detail', focus: true }])

  await rowB.press({ key: 'details' })
  expect((await rowA.find({ key: 'details' }))?.props.action).toBeUndefined()
  expect((await rowB.find({ key: 'details' }))?.props).toMatchObject({ action: 'diff:back' })
})
