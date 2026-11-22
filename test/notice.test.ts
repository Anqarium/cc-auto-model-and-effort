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
  test('a +name in the draft: a request line above the prompt, beside other bands; a plain name draws none', async ($, on) => {
    mock.clock(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('ui.status', () => ({ value: undefined }))
    on('store.get', () => ({ value: undefined }))
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return h(Text, null, 'other band')
    })
    on('prompt.change', ($, e) => ({ text: e.text })) // stands in for core, which echoes the box
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await $.prompt.change({ text: '+fable ile çöz', cursor: 14, origin: { kind: 'history' } })
    const props = { hasSurvey: false, isWorking: false, bodyColumns: 160 }
    const band = await $.ui.mount({ plugin: 'auto-model-effort', surface: 'terminal', component: 'AbovePrompt', props })
    expect(await band.find({ text: /Fable 5\.2 requested for this turn/ })).toBeDefined()
    expect(await band.find({ text: /other band/ })).toBeDefined()
    await band.unmount()

    await $.prompt.change({ text: 'fable ile çöz', cursor: 13, origin: { kind: 'history' } })
    const plain = await $.ui.mount({ plugin: 'auto-model-effort', surface: 'terminal', component: 'AbovePrompt', props })
    expect(await plain.find({ text: /requested for this turn/ })).toBeUndefined()
    await plain.unmount()
  })
  test('desktop: the label goes into the PromptHint line (left of the footer), not the band or SessionMode; terminal keeps SessionMode', async ($, on) => {
    mock.clock(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('ui.status', () => ({ value: undefined }))
    on('store.get', () => ({ value: undefined }))
    // Stands in for the engine's hint line and for another plugin's band (token-weather).
    on('ui.render', { component: 'PromptHint' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return h(Text, null, 'engine hint')
    })
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return h(Text, null, 'other band')
    })
    const bandProps = { hasSurvey: false, isWorking: false, bodyColumns: 160 }
    const hintProps = { isDraft: false, isWorking: false, hint: '' }

    await $.session.start({ surface: null, isInteractive: false, cwd: '/work' })
    const hint = await $.ui.mount({ plugin: 'auto-model-effort', surface: 'desktop', component: 'PromptHint', props: hintProps })
    expect(await hint.find({ text: /auto on/ })).toBeDefined()
    expect(await hint.find({ text: /engine hint/ })).toBeDefined()
    await hint.unmount()
    const band = await $.ui.mount({ plugin: 'auto-model-effort', surface: 'desktop', component: 'AbovePrompt', props: bandProps })
    expect(await band.find({ text: /auto on/ })).toBeUndefined()
    expect(await band.find({ text: /other band/ })).toBeDefined()
    await band.unmount()
    const mode = await $.ui.mount({ plugin: 'auto-model-effort', surface: 'desktop', component: 'SessionMode', props: { modes: [] } })
    expect(await mode.find({ text: /auto on/ })).toBeUndefined()
    await mode.unmount()

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    const terminalHint = await $.ui.mount({ plugin: 'auto-model-effort', surface: 'terminal', component: 'PromptHint', props: hintProps })
    expect(await terminalHint.find({ text: /auto on/ })).toBeUndefined()
    await terminalHint.unmount()
  })
})
