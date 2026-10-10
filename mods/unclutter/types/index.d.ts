export type ToolDetail = {
  id: string
  tool: string
  goal: string
  input: string
  output: string
  isError: boolean
  isRunning: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'unclutter': {
      selected: ToolDetail | null
      followOverride: boolean | null
      inputs: StateFamily<string>
      outputs: StateFamily<string>
      goals: StateFamily<string>
      highlighted: StateFamily<boolean>
    }
  }
}
