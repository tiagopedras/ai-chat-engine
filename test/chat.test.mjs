/**
 * Drives the built window in headless Chrome, off the same two files a page
 * with no build step loads, and asserts on what it draws.
 *
 *   npm run build
 *   node test/chat.test.mjs
 *
 * The helper behind the window is faked in test/harness.html, so nothing here
 * reaches Claude, the network or anyone's sessions.
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './cdp.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer((req, res) => {
  const file = join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(root) || !existsSync(file)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'text/plain' }).end(readFileSync(file));
});
await new Promise((r) => server.listen(0, r));
const url = `http://127.0.0.1:${server.address().port}/test/harness.html`;

const results = [];
const ok = (name, pass, detail = '') => { results.push(pass); console.log(`${pass ? '  ok  ' : ' FAIL '} ${name}${detail ? ' — ' + detail : ''}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const t = await launch(url, { size: '1400,900' });
await t.until(`!!window.AIChat`);
ok('the bundle hangs AIChat on window', await t.evaluate(`typeof AIChat.create === 'function'`));

/* ---- a plain modal ---- */
await t.evaluate(`
  window.chat = AIChat.create({
    transport: makeTransport(),
    ownerLabel: (id) => 'Task ' + id,
    onSend: (s) => __sent.push(s),
    onChange: () => { __changes++ },
  });
  chat.loadStatus();
`);
ok('status loads and the chat is available', await t.until(`chat.available()`));
ok('sessions load under their owner key', await t.until(`chat.sessionsFor('k1').length === 1`));
ok('newOwnerKey is six characters', await t.evaluate(`chat.newOwnerKey().length === 6`));

await t.evaluate(`chat.openNew('t1', 'k2', '')`);
ok('a new chat opens as a Tenon modal', await t.until(`!!document.querySelector('.tenon-modal__box.aic-box')`));
ok('  it says whose it is', await t.evaluate(`document.querySelector('.aic-for')?.textContent === 'Task t1'`));
ok('  it starts as "New chat"', await t.evaluate(`document.querySelector('.tenon-modal__title').textContent === 'New chat'`));
ok('  the composer has focus', await t.until(`document.activeElement?.classList.contains('aic-input')`));
ok('  the status line says it reads only', await t.evaluate(`/New conversation in .* · reads only/.test(document.querySelector('.aic-status').textContent)`));
await t.shot('/tmp/aic-modal-open.png');

await t.type('What is in **notes**? Tell me');
await t.key('Enter');
ok('Enter sends, and onSend hears it', await t.until(`__sent.length === 1 && __sent[0].ask.startsWith('What is in')`));
ok('  onSend has no session yet', await t.evaluate(`__sent[0].session === ''`));
ok('  the composer is cleared', await t.evaluate(`document.querySelector('.aic-input').value === ''`));
ok('  the user bubble renders bold', await t.until(`!!document.querySelector('.aic-bubble strong')`));
ok('  the status line is live while it runs', await t.until(`!!document.querySelector('.aic-status.aic-live .aic-doing')`));
ok('  Stop takes the slot Send had', await t.until(`!!document.querySelector('.aic-stop') && !document.querySelector('.aic-send')`));
ok('  the reply lands as markdown', await t.until(`!!document.querySelector('.aic-reply strong') && !!document.querySelector('.aic-reply li')`, 8000));
ok('  the trace summarises two steps', await t.evaluate(`document.querySelector('.tenon-disclosure__head')?.textContent.includes('2 steps · Read, Grep')`));
ok('  opening the trace lists them', await t.evaluate(`(document.querySelector('.tenon-disclosure__head').click(), 1)`) && await t.until(`document.querySelectorAll('.aic-timeline li').length === 2`));
ok('  the run finishes, Send returns', await t.until(`!!document.querySelector('.aic-send')`));
ok('  the finished status has the cost and time', await t.evaluate(`/done · \\d+s · under 1¢/.test(document.querySelector('.aic-status').textContent)`));
ok('  the title became the first question', await t.until(`document.querySelector('.tenon-modal__title').textContent.startsWith('What is in')`));
ok('  the session is filed under its id', await t.evaluate(`__payloads[0].session === '' && __payloads[0].owner === 'k2'`));
ok('  Retry and Edit sit on the last turn', await t.evaluate(`[...document.querySelectorAll('.aic-mineacts .tenon-button')].map(b=>b.textContent).join() === 'Copy,Retry,Edit'`));
await t.shot('/tmp/aic-modal-reply.png');

await t.evaluate(`[...document.querySelectorAll('.aic-mineacts .tenon-button')].find(b=>b.textContent==='Edit').click()`);
ok('Edit puts the words back in the composer', await t.until(`document.querySelector('.aic-input').value.startsWith('What is in')`));
await t.evaluate(`[...document.querySelectorAll('.aic-mineacts .tenon-button')].find(b=>b.textContent==='Retry').click()`);
ok('Retry sends the same words as a new turn', await t.until(`__payloads.length === 2 && __payloads[1].session === 's-new'`));
await t.until(`!!document.querySelector('.aic-send')`, 8000);
ok('  now two turns are showing', await t.evaluate(`document.querySelectorAll('.aic-turn').length === 2`));

/* permission banner */
await t.evaluate(`document.querySelector('.aic-input').focus()`);
await t.type('please ask permission');
await t.key('Enter');
ok('a permission request shows the banner', await t.until(`!!document.querySelector('.tenon-alert--warning.aic-permission')`));
ok('  with its title and detail', await t.evaluate(`(() => { const a = document.querySelector('.aic-permission'); return a.textContent.includes('Run rm -rf build?') && a.textContent.includes('clean the build folder') })()`));
ok('  and three answers', await t.evaluate(`[...document.querySelectorAll('.aic-permission .tenon-button')].map(b=>b.textContent).join() === 'Allow,Always allow,Deny'`));
ok('  the status line says it is waiting on you', await t.evaluate(`document.querySelector('.aic-status').textContent.includes('Waiting on your decision')`));
await t.shot('/tmp/aic-permission.png');
await t.evaluate(`[...document.querySelectorAll('.aic-permission .tenon-button')].find(b=>b.textContent==='Allow').click()`);
ok('  Allow answers through the transport and clears the banner', await t.until(`__answers.length === 1 && __answers[0].join() === 'r1,allow' && !document.querySelector('.aic-permission')`));
await t.until(`!!document.querySelector('.aic-send')`, 8000);

/* stop */
await t.evaluate(`document.querySelector('.aic-input').focus()`);
await t.type('go slow');
await t.key('Enter');
await t.until(`!!document.querySelector('.aic-stop')`);
await t.evaluate(`document.querySelector('.aic-stop').click()`);
ok('Stop ends the run and says so', await t.until(`!!document.querySelector('.aic-send') && [...document.querySelectorAll('.aic-err')].some(e => e.textContent.includes('Stopped.'))`, 6000));

/* closing */
await t.key('Escape');
ok('Escape closes it', await t.until(`!chat.isOpen() && !document.querySelector('.tenon-modal__box')`));
ok('  and the host hears about it', await t.evaluate(`__changes > 0`));

/* an earlier session */
await t.evaluate(`chat.openSession('t9', 'k1', 's-old')`);
ok('an earlier session is read back off disk', await t.until(`document.querySelector('.aic-bubble')?.textContent === 'earlier question'`));
ok('  with its answer as markdown', await t.evaluate(`!!document.querySelector('.aic-reply strong')`));
ok('  and the Open in Claude link', await t.evaluate(`document.querySelector('.aic-desktop')?.getAttribute('href') === 'claude://resume?session=s-old'`));
ok('  the title is the filed one', await t.evaluate(`document.querySelector('.tenon-modal__title').textContent === 'An earlier chat'`));
await t.key('Escape');
await t.until(`!chat.isOpen()`);
await t.evaluate(`chat.destroy()`);
ok('destroy takes the markup away', await t.evaluate(`!document.querySelector('[data-ai-chat]') && !document.querySelector('.tenon-modal')`));

/* ---- a window the host places ---- */
await t.evaluate(`
  window.rects = [];
  window.renamed = [];
  window.w = AIChat.create({
    transport: makeTransport(), windowed: true, inlineTools: true, thinkingGlyphs: true, mode: 'work', desktopLink: false,
    onRename: (n) => renamed.push(n), onRectChange: (r) => rects.push(r), onFocus: () => { window.focused = (window.focused || 0) + 1 },
    onChange: () => { window.wchanged = (window.wchanged || 0) + 1 },
  });
  w.loadStatus();
`);
await t.until(`w.available()`);
await t.evaluate(`
  w.growFrom(document.getElementById('card').getBoundingClientRect());
  w.setRect({ x: 300, y: 120, width: 640, height: 560 });
  w.setHeader({ title: 'Reading the 360 responses', subtitle: 'Design oversight · ~/Code/twinkl-hr', runState: 'running' });
  w.openSession('c1', 'c1', 's-old');
`);
ok('a windowed chat is a Tenon window, not a modal', await t.until(`!!document.querySelector('.tenon-window.aic-box') && !document.querySelector('.tenon-modal__scrim')`));
await wait(500);
ok('  it sits where the host put it', await t.evaluate(`(() => { const r = document.querySelector('.tenon-window').getBoundingClientRect(); return Math.round(r.left) === 300 && Math.round(r.top) === 120 && Math.round(r.width) === 640 && Math.round(r.height) === 560 })()`));
ok('  it takes the host\'s title and caption', await t.evaluate(`document.querySelector('.tenon-modal__title').textContent === 'Reading the 360 responses' && document.querySelector('.aic-sub').textContent.startsWith('Design oversight')`));
ok('  the state is stamped on the box', await t.evaluate(`document.querySelector('.tenon-window').dataset.state === 'running'`));
ok('  no Open in Claude link', await t.evaluate(`!document.querySelector('.aic-desktop')`));
ok('  the earlier tool call is a pill', await t.evaluate(`document.querySelectorAll('.aic-toolpills .tenon-pill').length === 1`));

await t.evaluate(`document.querySelector('.aic-input').focus()`);
await t.type('hello');
await t.key('Enter');
ok('  a run shows the glyph indicator', await t.until(`!!document.querySelector('.aic-status.aic-live .aic-star.aic-glyph')`));
ok('  every tool call is a pill where it happened', await t.until(`document.querySelectorAll('.aic-toolpills .tenon-pill').length >= 3`, 8000));
await t.until(`!!document.querySelector('.aic-send')`, 8000);
await t.shot('/tmp/aic-window.png');

// drag the head, and the host hears where it ended
const [hx, hy] = await t.center('.tenon-modal__titles');
await t.drag(hx + 150, hy, 60, 30);
await wait(500);
ok('dragging the head reports the new rect', await t.evaluate(`rects.length === 1 && rects[0].x === 360 && rects[0].y === 150`), await t.evaluate(`JSON.stringify(rects)`));
ok('any press inside counts as focus', await t.evaluate(`window.focused >= 1`));

// rename in place
await t.evaluate(`document.querySelector('.tenon-editable').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
await wait(300);
await t.evaluate(`(() => { const e = document.querySelector('.tenon-editable'); e.textContent = 'A better name'; })()`);
await t.key('Enter');
ok('renaming in place hands back what was typed', await t.until(`renamed.length === 1 && renamed[0] === 'A better name'`));

// peek and active
await t.evaluate(`w.setPeeked(true)`);
ok('peeked dims it', await t.until(`document.querySelector('.tenon-window').classList.contains('tenon-window--peeked')`));
await t.evaluate(`w.setPeeked(false); w.setActive(false)`);
await t.key('Escape');
await wait(400);
ok('Escape does nothing while the host says another window is active', await t.evaluate(`w.isOpen() && !!document.querySelector('.tenon-window')`));
await t.evaluate(`w.setActive(true); w.setZIndex(200)`);
ok('the host sets the stacking order', await t.until(`document.querySelector('.tenon-window-layer').style.zIndex === '200'`));
await t.key('Escape');
ok('Escape closes it once it is active, after the shrink', await t.until(`!w.isOpen() && !document.querySelector('.tenon-window')`, 3000));
ok('  and the host hears once it has gone', await t.evaluate(`window.wchanged >= 1`));
await t.evaluate(`w.destroy()`);
ok('destroy leaves nothing behind', await t.evaluate(`!document.querySelector('[data-ai-chat]') && !document.querySelector('.tenon-window-layer')`));

/* ---- docked: minimised and anchored ---- */
await t.evaluate(`
  window.d1 = AIChat.create({ transport: makeTransport(), windowed: true, dockable: true });
  window.d2 = AIChat.create({ transport: makeTransport(), windowed: true, dockable: true });
  d1.openNew('t1', 'k1', ''); d2.openNew('t2', 'k2', '');
`);
ok('a dockable chat offers Minimise', await t.until(`document.querySelectorAll('.aic-minimise').length === 2`));
ok('a chat without dockable offers nothing new', await t.evaluate(`(() => { const x = AIChat.create({ transport: makeTransport(), windowed: true }); x.openNew('t3','k3',''); const n = document.querySelectorAll('.aic-minimise').length; x.destroy(); return n === 2; })()`));
await t.evaluate(`document.querySelector('.aic-minimise').click()`);
ok('Minimise docks it as a bar', await t.until(`document.querySelectorAll('.aic-minimised').length === 1 && d1.dockState() === 'minimised'`));
ok('  the bar hides the conversation', await t.evaluate(`getComputedStyle(document.querySelector('.aic-minimised .tenon-modal__body')).display === 'none'`));
ok('  and sits on the bottom-right edge', await t.evaluate(`(() => { const r = document.querySelector('.aic-minimised').getBoundingClientRect(); return Math.abs(r.bottom - innerHeight) < 2 && innerWidth - r.right < 40; })()`));
await t.evaluate(`d2.minimise()`);
ok('a second one lines up to the left of the first', await t.until(`(() => { const [a, b] = [...document.querySelectorAll('.aic-minimised')].map(e => e.getBoundingClientRect()); return a && b && Math.abs(a.left - b.left) > 200; })()`));
await t.evaluate(`document.querySelector('.aic-minimised .tenon-modal__title').click()`);
ok('clicking a bar opens it anchored', await t.until(`document.querySelectorAll('.aic-anchored').length === 1`));
ok('  an anchored panel has no grips to resize', await t.evaluate(`getComputedStyle(document.querySelector('.aic-anchored .tenon-window__grip')).display === 'none'`));
const before = await t.evaluate(`JSON.stringify(document.querySelector('.aic-anchored').getBoundingClientRect())`);
await t.evaluate(`(() => { const h = document.querySelector('.aic-anchored .tenon-window__head'); const r = h.getBoundingClientRect();
  h.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.left + 20, clientY: r.top + 10 }));
  window.dispatchEvent(new PointerEvent('pointermove', { clientX: r.left - 200, clientY: r.top - 200 }));
  window.dispatchEvent(new PointerEvent('pointerup', {})); })()`);
await wait(100);
ok('  and does not move when dragged', await t.evaluate(`JSON.stringify(document.querySelector('.aic-anchored').getBoundingClientRect())`) === before);
await t.evaluate(`document.querySelector('.aic-anchored .aic-expand').click()`);
ok('Expand takes it back to the ordinary window', await t.until(`document.querySelectorAll('.aic-docked').length === 1 && [d1, d2].some(d => d.dockState() === 'none')`));
await t.evaluate(`d1.closeChat(); d2.closeChat()`);
ok('closing takes both out of the dock', await t.until(`!document.querySelector('.aic-docked') && d1.dockState() === 'none' && d2.dockState() === 'none'`, 3000));
await t.evaluate(`d1.destroy(); d2.destroy()`);

const errors = t.logs.filter((l) => /^EXC|^error/i.test(l));
ok('no console errors', errors.length === 0, errors.join(' | '));
t.close();
server.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
