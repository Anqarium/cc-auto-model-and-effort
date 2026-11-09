// Runs under `claude plugin test .` (the 'claude-code/testing' kit), not `node --test`.
// Hooks registered with the test's `on` sit beneath the plugin and stand in for the engine.
import { describe, expect, mock, test } from 'claude-code/testing'

describe('auto-model-effort', () => {
  test('shows the on notice right of the prompt at startup and hides it after 4 s', async ($, on) => {
    const clock = mock.clock(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    // A $ call the plugin makes is answered with { value } (or { deny }).
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('ui.status', () => ({ value: undefined }))
    on('store.get', () => ({ value: undefined })) // the learned model ids are read at startup
    // The engine would draw the SessionMode labels; here they are drawn as one plain text.
    on('ui.render', { component: 'SessionMode' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return h(Text, null, e.props.modes.join(' & ') || '-')
    })

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    const ui = await $.ui.mount({ plugin: 'auto-model-effort', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
    expect(await ui.find({ text: /auto on · \/auto to turn off/ })).toBeDefined()

    await clock.advance(4000)
    expect(await ui.find({ text: /auto on/ })).toBeUndefined()
    await ui.unmount()
  })
  test('desktop: the label goes into the AbovePrompt band, other bands are kept; terminal gets none', async ($, on) => {
    mock.clock(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('ui.status', () => ({ value: undefined }))
    on('store.get', () => ({ value: undefined }))
    // Stands in for another plugin's band (token-weather) beneath this one.
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return h(Text, null, 'other band')
    })
    const props = { hasSurvey: false, isWorking: false }

    await $.session.start({ surface: null, isInteractive: false, cwd: '/work' })
    const desktop = await $.ui.mount({ plugin: 'auto-model-effort', surface: 'desktop', component: 'AbovePrompt', props })
    expect(await desktop.find({ text: /auto on/ })).toBeDefined()
    expect(await desktop.find({ text: /other band/ })).toBeDefined()
    await desktop.unmount()

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    const terminal = await $.ui.mount({ plugin: 'auto-model-effort', surface: 'terminal', component: 'AbovePrompt', props })
    expect(await terminal.find({ text: /auto on/ })).toBeUndefined()
    await terminal.unmount()
  })
})
