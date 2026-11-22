// The state this mod shares through `$.state` (any plugin reads a value, only its owner writes it).
//
// `auto-model-effort.label` is the mode label shown next to the prompt (`🍃 Haiku 5.5 · medium · trivial 0`), or null
// when there is none. The desktop cannot draw it beside token-weather's band from here (the band reaches this mod as an
// opaque engine node), so token-weather draws it inside its own row; this mod draws it only when token-weather has
// written no reading, i.e. is not running.
//
// `token-weather.readings` is token-weather's own value, declared here only so this mod can tell whether it runs.
export type ModeLabel = {
  text: string
  // A theme color name (Fable, Opus, Haiku...); absent for the dim default and for notices.
  color?: string
  bold?: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'auto-model-effort': { label: ModeLabel | null }
    'token-weather': { readings: { tokens: number; window: number; percent: number }[] }
  }
}
