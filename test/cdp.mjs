// A tiny Chrome DevTools driver for the tests: launches headless Chrome on a URL and exposes
// evaluate, until, click, drag, type, key and shot. No dependency, the same approach the board's own tests use.
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
export async function launch(url, { port = 9555, size = '1400,900', profile = '/tmp/cdp-profile-' + port } = {}) {
  const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new', `--remote-debugging-port=${port}`, '--no-first-run', `--user-data-dir=${profile}`,
    `--window-size=${size}`, url], { stdio: 'ignore' })
  let wsUrl
  for (let i = 0; i < 80 && !wsUrl; i++) {
    try {
      const t = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page')
      wsUrl = t?.webSocketDebuggerUrl
    } catch {}
    if (!wsUrl) await new Promise(r => setTimeout(r, 250))
  }
  const ws = new WebSocket(wsUrl); await new Promise(r => (ws.onopen = r))
  let id = 0; const pending = new Map(); const logs = []
  ws.onmessage = e => { const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
    else if (m.method === 'Runtime.consoleAPICalled') logs.push(m.params.type + ': ' + m.params.args.map(a => a.value ?? a.description).join(' '))
    else if (m.method === 'Runtime.exceptionThrown') logs.push('EXC: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text)) }
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
  await send('Runtime.enable'); await send('Page.enable')
  const api = {
    logs, send,
    async evaluate(expr) { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'eval failed'); return r.result.result.value },
    async until(expr, ms = 5000) { const t = Date.now(); while (Date.now() - t < ms) { if (await api.evaluate(expr).catch(() => false)) return true; await new Promise(r => setTimeout(r, 100)) } return false },
    async mouse(type, x, y) { await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 }) },
    async click(x, y) { await api.mouse('mouseMoved', x, y); await api.mouse('mousePressed', x, y); await api.mouse('mouseReleased', x, y) },
    async drag(x, y, dx, dy) { await api.mouse('mouseMoved', x, y); await api.mouse('mousePressed', x, y); for (let i = 1; i <= 6; i++) await api.mouse('mouseMoved', x + dx * i / 6, y + dy * i / 6); await api.mouse('mouseReleased', x + dx, y + dy) },
    async key(key, code = key, modifiers = 0) {
      const vk = { Escape: 27, Enter: 13 }[key] || 0
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, modifiers, text: key === 'Enter' && !modifiers ? '\r' : undefined })
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, modifiers })
    },
    async type(text) { await send('Input.insertText', { text }) },
    async shot(path) { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(path, Buffer.from(r.result.data, 'base64')) },
    center: (sel) => api.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2,r.left,r.top,r.width,r.height]})()`),
    close() { try { ws.close() } catch {} chrome.kill() },
  }
  return api
}
