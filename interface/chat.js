/* ai_chat/interface/chat.js — a Claude chat modal any local app can drop in.
 *
 * No build step, no dependency, one global: window.AIChat. A host page does
 *
 *   const chat = AIChat.create({ endpoints: {...} });   // once
 *   chat.loadStatus();                                  // once, on load
 *   chat.openNew(ownerId, ownerKey, seedText);           // to start a chat
 *
 * and reads back what it needs — chat.available(), chat.sessionsFor(key),
 * chat.renderSection({...}) — to draw its own "chats on this thing" list
 * wherever that belongs in its own page. The modal itself the widget owns
 * outright: it injects its own DOM on first use and nothing in the host page
 * has to exist beforehand except a `<link>` to chat.css.
 *
 * "Owner" is this module's word for whatever the host organises conversations
 * by — a task id, a ticket number, a note path. An owner can carry more than
 * one conversation (`ownerKey` below groups them), because the work on one
 * thing is rarely one conversation — reading a set of responses, drafting
 * what comes out of them and checking old wording against them are three,
 * and keeping them apart is the point: each stays short enough to return to.
 *
 * Three things hold a conversation together and none is a copy of another:
 *
 *   ownerKey                      which group of sessions this is
 *   the host's sessions store     which session ids sit under that key
 *   Claude Code's own .jsonl      what was actually said
 *
 * The last one is why this module never stores a transcript of its own. That
 * file is what the CLI resumes from and what Claude Desktop imports, so a
 * conversation carried on anywhere else comes back complete rather than as a
 * stale copy.
 *
 * The modal follows the claude.ai teardown in ../claude-chat-interface-findings.md:
 * attribution by asymmetry (a bubble for you, plain prose for the reply), one
 * slot for the primary action, a status line whose words are the progress.
 * Two things it deliberately does not copy — the trace stays visible rather
 * than waiting for a hover, and the reply keeps a Copy button.
 */
(function (global) {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function mdInline(s) {
    return esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])_([^_]+)_/g, '$1<em>$2</em>');
  }

  /* Enough markdown for a reply — paragraphs, bullets, headings, fenced code.
     The inline half is mdInline, just above. */
  function mdBlock(text) {
    const lines = String(text).replace(/\r/g, '').split('\n');
    const out = [];
    let para = [], list = null, code = null;
    const flushPara = () => {
      if (para.length) { out.push('<p>' + para.map(mdInline).join('<br>') + '</p>'); para = []; }
    };
    const flushList = () => {
      if (list) { out.push('<ul>' + list.map(i => '<li>' + mdInline(i) + '</li>').join('') + '</ul>'); list = null; }
    };
    const flush = () => { flushPara(); flushList(); };
    lines.forEach(raw => {
      const l = raw.replace(/\s+$/, '');
      if (/^\s*```/.test(l)) {
        if (code === null) { flush(); code = []; }
        else { out.push('<pre><code>' + esc(code.join('\n')) + '</code></pre>'); code = null; }
        return;
      }
      if (code !== null) { code.push(raw); return; }
      if (!l.trim()) { flush(); return; }
      const bullet = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(l);
      if (bullet) { flushPara(); (list = list || []).push(bullet[1]); return; }
      const head = /^\s*#{1,6}\s+(.*)$/.exec(l);
      if (head) { flush(); out.push('<p class="aic-h">' + mdInline(head[1]) + '</p>'); return; }
      flushList();
      para.push(l.trim());
    });
    if (code !== null) out.push('<pre><code>' + esc(code.join('\n')) + '</code></pre>');
    flush();
    return out.join('');
  }

  const TOOL_FIELD = {
    Read: 'file_path', Edit: 'file_path', Write: 'file_path', Glob: 'pattern', Grep: 'pattern',
    Bash: 'command', WebFetch: 'url', WebSearch: 'query', Skill: 'skill', Task: 'description'
  };
  function toolLabel(name, input, cwd) {
    input = input || {};
    let what = TOOL_FIELD[name] && input[TOOL_FIELD[name]] ? String(input[TOOL_FIELD[name]]) : '';
    if (!what) {
      const first = Object.keys(input).map(k => input[k]).find(v => typeof v === 'string');
      what = first || '';
    }
    if (cwd && what.indexOf(cwd + '/') === 0) what = what.slice(cwd.length + 1);
    what = what.replace(/\s+/g, ' ').trim();
    if (what.length > 70) what = what.slice(0, 69) + '…';
    return what ? name + ' ' + what : name;
  }

  /* What to call what it is doing now, in words rather than in tool names.
     Rewritten in place as the run moves, which is the whole of the progress
     indicator — no spinner, no bar, the content is the progress. */
  const DOING = {
    starting: 'Starting up', thinking: 'Thinking it through', writing: 'Writing the answer',
    Read: 'Reading a file', Glob: 'Looking for files', Grep: 'Searching the text',
    Bash: 'Running a command', Edit: 'Editing a file', Write: 'Writing a file',
    Skill: 'Loading a skill', Task: 'Handing part of it to a subagent',
    WebFetch: 'Fetching a page', WebSearch: 'Searching the web', done: 'Finished'
  };
  function runDoing(run) { return DOING[run.status] || (run.status ? 'Using ' + run.status : 'Working'); }

  function runCost(n) { return n < 0.01 ? 'under 1¢' : '$' + n.toFixed(2); }
  function runDoneLabel(run) {
    const secs = Math.max(1, Math.round((run.ms || (Date.now() - run.started)) / 1000));
    const bits = [run.status === 'done' ? 'done' : 'stopped', secs + 's'];
    if (run.cost) bits.push(runCost(run.cost));
    return bits.join(' · ');
  }

  /* What to call a conversation, taken from the first thing said in it. The
     whole message is not a name: one sentence, cut at a word. */
  function chatTitle(ask) {
    let t = String(ask).replace(/\s+/g, ' ').trim();
    const stop = /[.?!]\s/.exec(t);
    if (stop && stop.index > 12) t = t.slice(0, stop.index + 1);
    if (t.length > 54) t = t.slice(0, 54).replace(/\s+\S*$/, '') + '…';
    return t.replace(/[.,;:\s]+$/, '');
  }

  function today() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function whenLabel(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const days = Math.floor((today() - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 7) return days + ' days ago';
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  /* Imports the session into Claude Desktop and carries it on there — the
     same conversation, the same history, in the app rather than in this
     modal. `?session=` on the /code routes only accepts the desktop's own
     local_ ids, but /resume takes a CLI session id and adopts it. */
  function desktopHref(sessionId) {
    return 'claude://resume?session=' + encodeURIComponent(sessionId);
  }

  const MODAL_HTML =
    '<div class="aic-wrap" id="aicWrap" aria-hidden="true">' +
      '<div class="aic-scrim" id="aicScrim"></div>' +
      '<section class="aic-box" id="aicBox" role="dialog" aria-modal="true" aria-labelledby="aicTitle">' +
        '<header class="aic-head">' +
          '<div class="aic-names">' +
            '<strong id="aicTitle">Chat</strong>' +
            '<span class="aic-for" id="aicFor"></span>' +
          '</div>' +
          '<a class="aic-btn aic-ghost" id="aicDesktop" href="#" target="_blank" rel="noopener"' +
            ' title="Imports this session into Claude Desktop and carries it on there">Claude Desktop</a>' +
          '<button class="aic-btn aic-ghost" id="aicClose" type="button">Close</button>' +
        '</header>' +
        '<div class="aic-status" id="aicStatus" aria-live="polite"></div>' +
        '<div class="aic-bodywrap">' +
          '<div class="aic-body" id="aicBody"></div>' +
          // Hidden unless a live run has pushed content below what is
          // visible — see updateScrollPill(). Its own row, not inside
          // #aicBody, because that element's innerHTML gets replaced whole
          // on every render.
          '<button type="button" class="aic-scrollpill aic-hidden" id="aicScrollPill">New messages ↓</button>' +
        '</div>' +
        '<form class="aic-foot" id="aicFoot" autocomplete="off">' +
          '<textarea id="aicInput" rows="1" spellcheck="false"></textarea>' +
          '<button class="aic-btn aic-primary" id="aicSend" type="submit">Send</button>' +
          '<button class="aic-btn aic-ghost aic-hidden" id="aicStop" type="button">Stop</button>' +
        '</form>' +
      '</section>' +
    '</div>';

  function create(opts) {
    opts = opts || {};
    const endpoints = Object.assign({
      status: '/claude.json',
      sessions: '/claude/sessions.json',
      transcript: '/claude/transcript.json',
      forget: '/claude/forget',
      run: '/claude'
    }, opts.endpoints || {});
    const guard = Object.assign({ name: 'X-Board', value: '1' }, opts.guardHeader || {});
    const isLocked = opts.isLocked || function () { return false; };
    const onChange = opts.onChange || function () {};
    const onSessionsChanged = opts.onSessionsChanged || function () {};
    const onStatusChanged = opts.onStatusChanged || function () {};
    const placeholder = opts.placeholder || 'Ask Claude…';
    const readOnlyHelp = opts.readOnlyHelp ||
      'Each one runs on this machine and reads only. They are kept apart on purpose — ' +
      'one conversation per question stays short enough to be worth coming back to.';

    let claudeStatus = null;
    let chatsIndex = {};
    const runs = {};
    let runCounter = 0;
    let current = null;   // the open chat, or null when the modal is closed
    let runTicker = null;
    let dom = null;

    function mount() {
      if (dom) return;
      const holder = document.createElement('div');
      holder.innerHTML = MODAL_HTML;
      document.body.appendChild(holder.firstElementChild);
      dom = {
        wrap: document.getElementById('aicWrap'),
        scrim: document.getElementById('aicScrim'),
        title: document.getElementById('aicTitle'),
        forLine: document.getElementById('aicFor'),
        desktop: document.getElementById('aicDesktop'),
        close: document.getElementById('aicClose'),
        status: document.getElementById('aicStatus'),
        body: document.getElementById('aicBody'),
        scrollPill: document.getElementById('aicScrollPill'),
        foot: document.getElementById('aicFoot'),
        input: document.getElementById('aicInput'),
        send: document.getElementById('aicSend'),
        stop: document.getElementById('aicStop')
      };
      dom.input.placeholder = placeholder;
      dom.close.onclick = closeChat;
      dom.scrim.onclick = closeChat;
      dom.foot.onsubmit = e => { e.preventDefault(); send(); };
      dom.stop.onclick = () => { const run = currentRun(); if (run && run.ctrl) run.ctrl.abort(); };
      // The box grows line by line instead of scrolling inside itself, so a
      // long question stays visible while it is being written.
      dom.input.addEventListener('input', e => autoGrow(e.target));
      // Enter sends, shift-Enter is a new line.
      dom.input.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
      });
      dom.body.addEventListener('click', handleBodyClick);
      // Scrolling away from the bottom mid-run stops the pull back down to
      // it — see the wasNearBottom check in render() — and the pill offers
      // a way back rather than leaving the tail end of a growing answer
      // permanently out of view.
      dom.body.addEventListener('scroll', updateScrollPill);
      dom.scrollPill.onclick = () => {
        dom.body.scrollTop = dom.body.scrollHeight;
        updateScrollPill();
      };
      // Escape closes the chat before it closes whatever is behind it.
      window.addEventListener('keydown', e => {
        if (e.key === 'Escape' && current) { e.stopPropagation(); closeChat(); }
      }, true);
    }

    function nearBottom() {
      if (!dom) return true;
      return dom.body.scrollHeight - dom.body.scrollTop - dom.body.clientHeight < 80;
    }
    function updateScrollPill() {
      if (!dom) return;
      const show = !nearBottom() && dom.body.scrollHeight > dom.body.clientHeight;
      dom.scrollPill.classList.toggle('aic-hidden', !show);
    }

    function handleBodyClick(e) {
      const twist = e.target.closest('.aic-tracehead');
      if (twist) {
        const turns = currentTurns();
        const turn = turns[+twist.dataset.turn];
        if (turn) { turn.traceOpen = !turn.traceOpen; render(); }
        return;
      }
      const retry = e.target.closest('[data-retry]');
      if (retry) { retryTurn(+retry.dataset.retry); return; }
      const editBtn = e.target.closest('[data-edit]');
      if (editBtn) { editTurn(+editBtn.dataset.edit); return; }
      const copy = e.target.closest('[data-copy]');
      if (copy) {
        const text = copy.dataset.copy;
        (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject())
          .then(() => flashCopy(copy, true), () => flashCopy(copy, false));
      }
    }

    /* Retry and Edit only make sense on the last turn. claude.ai can fork a
       new response from any earlier message in the thread; this engine
       resumes a session by appending to it (`--resume`), so there is no way
       to rewind to an earlier point without discarding what came after —
       Retry here resends the same words as a new turn, Edit loads them back
       into the composer to tweak first. Both are honest about being that
       rather than pretending to rewrite history. */
    function retryTurn(i) {
      const c = current;
      if (!c) return;
      const turns = currentTurns();
      const turn = turns[i];
      const run = currentRun();
      if (!turn || (run && run.running)) return;
      startRun({
        owner: c.owner, key: c.key, session: c.session, ask: turn.ask,
        title: (sessionsFor(c.key).find(s => s.id === c.session) || {}).title || chatTitle(turn.ask),
        mode: c.mode || 'ask',
        turns: run ? run.turns : (c.turns || [])
      });
    }
    function editTurn(i) {
      const turns = currentTurns();
      const turn = turns[i];
      if (!turn || !dom) return;
      dom.input.value = turn.ask;
      autoGrow(dom.input);
      dom.input.focus();
    }
    function flashCopy(btn, copied) {
      btn.textContent = copied ? 'Copied' : 'Copy failed';
      btn.classList.toggle('aic-done', copied);
      btn.classList.toggle('aic-warn', !copied);
      clearTimeout(btn._t);
      btn._t = setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('aic-done', 'aic-warn'); },
        copied ? 1500 : 4000);
    }

    function guardHeaders(extra) {
      const h = Object.assign({}, extra || {});
      h[guard.name] = guard.value;
      return h;
    }

    async function loadStatus() {
      try {
        const res = await fetch(endpoints.status + '?t=' + Date.now(), { cache: 'no-store' });
        if (!res.ok) return;
        const cfg = await res.json();
        claudeStatus = (cfg && cfg.available) ? cfg : null;
        onStatusChanged(claudeStatus);
        if (claudeStatus) loadSessions();
      } catch (err) { /* no endpoint, no buttons, no complaint */ }
    }

    async function loadSessions() {
      try {
        const res = await fetch(endpoints.sessions + '?t=' + Date.now(), { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        chatsIndex = (data && data.chats) || {};
        onSessionsChanged(chatsIndex);
        if (current) render();
        onChange();
      } catch (err) { /* no helper, no list */ }
    }

    function available() { return !!claudeStatus && !isLocked(); }
    function status() { return claudeStatus; }
    function home() { return claudeStatus ? claudeStatus.home : ''; }

    function sessionsFor(key) {
      const rows = (key && chatsIndex[key]) || [];
      return rows.slice().sort((a, b) => String(b.updated || '').localeCompare(String(a.updated || '')));
    }

    /* Six characters of base36. It means nothing on its own, which is the
       idea: the host says which owner, the sessions store says which
       conversations sit under that key. */
    function newOwnerKey() {
      let key = '';
      do { key = Math.random().toString(36).slice(2, 8); } while (key.length < 6 || chatsIndex[key]);
      return key;
    }

    function runFor(sessionId) {
      if (!sessionId) return null;
      const found = Object.keys(runs).map(k => runs[k]).filter(r => r.session === sessionId);
      return found.length ? found[found.length - 1] : null;
    }
    function liveRuns() { return Object.keys(runs).map(k => runs[k]).filter(r => r.running); }

    /* ---- The list of conversations under one owner key ----
       The host embeds this HTML wherever "chats on this thing" belongs on its
       own page — a task drawer, a sidebar, wherever. */
    function renderSection(spec) {
      spec = spec || {};
      const ownerId = spec.ownerId, key = spec.ownerKey, label = spec.label || 'Chats';
      if (!available()) return '';
      const rows = sessionsFor(key);
      const list = rows.map(s => {
        const run = runFor(s.id);
        const busy = run && run.running;
        return '<div class="aic-row' + (busy ? ' aic-busy' : '') + '" data-session="' + esc(s.id) + '">' +
          '<button type="button" class="aic-open" data-session="' + esc(s.id) + '"' +
            ' data-owner="' + esc(ownerId) + '" data-key="' + esc(key) + '">' +
            '<span class="aic-rowtitle">' + esc(s.title || 'Untitled chat') + '</span>' +
            '<span class="aic-rowmeta">' +
              (busy ? '<em class="aic-live">running</em>' : esc(whenLabel(s.updated))) +
              (s.mode === 'work' ? ' · <em class="aic-work">can write</em>' : '') +
            '</span>' +
          '</button>' +
          '<a class="aic-icon" href="' + desktopHref(s.id) + '"' +
            ' title="Open this conversation in Claude Desktop">Desktop</a>' +
          '<button type="button" class="aic-icon aic-forget" data-session="' + esc(s.id) + '"' +
            ' data-key="' + esc(key) + '" title="Take it off this list. The transcript itself is left alone.">×</button>' +
        '</div>';
      }).join('');
      return '<div class="aic-field">' +
        '<span>' + esc(label) + (rows.length ? ' <em class="aic-sublabel">' + rows.length + '</em>' : '') + '</span>' +
        (list || '<p class="aic-none">No conversations yet.</p>') +
        '<button type="button" class="aic-addsub" data-owner="' + esc(ownerId) + '">+ New chat</button>' +
        '<span class="aic-help">' + esc(readOnlyHelp.replace('this machine', home() ? 'this machine, in ' + home() : 'this machine')) + '</span>' +
      '</div>';
    }

    /* ---- The modal ---- */

    function isOpen() { return !!current; }

    function openInternal(ownerId, ownerKey, sessionId, seed) {
      mount();
      current = { owner: ownerId, key: ownerKey, session: sessionId || '', seed: seed || '',
                  turns: null, loading: false, run: runFor(sessionId) };
      dom.wrap.classList.add('aic-on');
      dom.wrap.setAttribute('aria-hidden', 'false');
      document.body.classList.add('aic-chatting');
      render();
      if (sessionId && !runFor(sessionId)) loadTranscript(sessionId);
      setTimeout(() => { if (dom.input) dom.input.focus(); }, 60);
    }
    /* A brand new conversation, or one seeded with a prompt but not sent —
       seeded runs still have a [placeholder] in them sometimes, and firing on
       open would send it before anyone had a chance to fill it in. */
    function openNew(ownerId, ownerKey, seed) { openInternal(ownerId, ownerKey, '', seed || ''); }
    function openSession(ownerId, ownerKey, sessionId) { openInternal(ownerId, ownerKey, sessionId, ''); }

    function closeChat() {
      current = null;
      if (dom) {
        dom.wrap.classList.remove('aic-on');
        dom.wrap.setAttribute('aria-hidden', 'true');
      }
      document.body.classList.remove('aic-chatting');
      onChange();
    }

    async function loadTranscript(sessionId) {
      const c = current;
      if (!c) return;
      c.loading = true;
      render();
      const row = sessionsFor(c.key).find(s => s.id === sessionId);
      const q = '?session=' + encodeURIComponent(sessionId) + '&cwd=' + encodeURIComponent((row && row.cwd) || '');
      try {
        const res = await fetch(endpoints.transcript + q, { cache: 'no-store' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        if (!current || current.session !== sessionId) return;
        current.turns = data.toobig ? [] : data.turns.map(t => ({
          ask: t.ask, reply: t.reply, error: '', cost: 0,
          tools: (t.tools || []).map(x => toolLabel(x.name, x.input, (row && row.cwd) || ''))
        }));
        current.toobig = !!data.toobig;
      } catch (err) {
        if (current) current.loadErr =
          'That conversation is not on disk any more — Claude Code keeps the transcripts, ' +
          'and this one has been cleared.';
      }
      if (current) { current.loading = false; render(); }
    }

    /* What the modal is showing: a live run if there is one, otherwise
       whatever was read back off disk. Never both. A conversation started
       from here holds its run directly, because a new one has no session id
       until the CLI's first line arrives, and looking it up by a session it
       does not have yet would leave the modal claiming to be idle while it
       was already working. */
    function currentRun() {
      if (!current) return null;
      if (current.run) return current.run;
      return runFor(current.session);
    }
    function currentTurns() {
      if (!current) return [];
      const run = currentRun();
      return run ? run.turns : (current.turns || []);
    }

    function render() {
      const c = current;
      if (!c || !dom) return;
      const run = currentRun();
      const row = sessionsFor(c.key).find(s => s.id === c.session);

      dom.title.textContent = (row && row.title) || (run && run.title) || 'New chat';
      dom.forLine.textContent = (opts.ownerLabel && opts.ownerLabel(c.owner)) || '';

      if (c.session) { dom.desktop.href = desktopHref(c.session); dom.desktop.classList.remove('aic-hidden'); }
      else dom.desktop.classList.add('aic-hidden');

      if (run && run.running) {
        dom.status.className = 'aic-status aic-live';
        dom.status.innerHTML = '<span class="aic-star"></span>' +
          '<span class="aic-doing">' + esc(runDoing(run)) + '</span>' +
          '<em class="aic-clock">' + Math.round((Date.now() - run.started) / 1000) + 's</em>';
      } else if (run) {
        dom.status.className = 'aic-status';
        dom.status.textContent = (run.mode === 'work' ? 'Claude, working in ' : 'Claude, reading in ') +
          (run.home || '') + ' · ' + runDoneLabel(run);
      } else if (c.loading) {
        dom.status.className = 'aic-status';
        dom.status.textContent = 'Reading the transcript…';
      } else if (c.session) {
        dom.status.className = 'aic-status';
        dom.status.textContent = 'Earlier conversation · ' + ((row && whenLabel(row.updated)) || '');
      } else {
        dom.status.className = 'aic-status';
        dom.status.textContent = 'New conversation in ' + home() + ' · reads only';
      }

      // Send and Stop share one slot, so the primary action is never
      // competing with another for the same glance.
      const busy = !!(run && run.running);

      // Captured before the body's content changes below: whether the
      // reader was already at the bottom is what decides whether new
      // content pulls the view down with it or leaves it where it was and
      // shows the "New messages" pill instead.
      const wasNearBottom = nearBottom();

      const turns = currentTurns();
      if (c.loadErr && !turns.length) {
        dom.body.innerHTML = '<p class="aic-err">' + esc(c.loadErr) + '</p>';
      } else if (c.toobig) {
        dom.body.innerHTML = '<p class="aic-none">That transcript is too large to replay here. ' +
          'Claude Desktop will open it in full.</p>';
      } else if (!turns.length) {
        dom.body.innerHTML = c.loading ? '<p class="aic-none">…</p>'
          : '<p class="aic-none">Nothing said yet. What it can see is everything under <code>' +
            esc(home()) + '</code>.</p>';
      } else {
        dom.body.innerHTML = turns.map((t, i) => turnHTML(t, i, i === turns.length - 1 && !busy)).join('');
      }
      if (run && run.running && wasNearBottom) dom.body.scrollTop = dom.body.scrollHeight;
      updateScrollPill();

      dom.stop.classList.toggle('aic-hidden', !busy);
      dom.send.classList.toggle('aic-hidden', busy);
      dom.input.disabled = busy;
      if (c.seed && !turns.length) { dom.input.value = c.seed; c.seed = ''; autoGrow(dom.input); }
    }

    function autoGrow(el) {
      if (!el) return;
      el.style.height = 'auto';
      el.style.height = Math.min(160, Math.max(38, el.scrollHeight)) + 'px';
    }

    /* Who said what is carried by the shape, not by a label: yours is a
       filled bubble pushed right, the reply is unbubbled prose running the
       full width. No avatars, no "you:" prefix.

       `showActs` only ever holds for the last turn, and never mid-run — see
       retryTurn()/editTurn() for why only the last one gets Retry and Edit. */
    function turnHTML(turn, i, showActs) {
      const trace = traceHTML(turn, i);
      const mineActs = showActs
        ? '<div class="aic-mineacts">' +
            '<button type="button" class="aic-mini" data-copy="' + esc(turn.ask) + '">Copy</button>' +
            '<button type="button" class="aic-mini" data-retry="' + i + '">Retry</button>' +
            '<button type="button" class="aic-mini" data-edit="' + i + '">Edit</button>' +
          '</div>' : '';
      const reply = turn.reply
        ? '<div class="aic-reply">' + mdBlock(turn.reply) +
          '<div class="aic-acts"><button type="button" class="aic-copy" data-copy="' +
          esc(turn.reply) + '">Copy</button></div></div>' : '';
      const err = turn.error
        ? '<p class="aic-err">' + esc(turn.error) +
          (turn.detail ? '<em>' + esc(turn.detail) + '</em>' : '') + '</p>' : '';
      return '<div class="aic-turn">' +
        '<div class="aic-mine"><div class="aic-minewrap">' +
          '<div class="aic-bubble">' + mdInline(turn.ask) + '</div>' + mineActs +
        '</div></div>' +
        trace + reply + err + '</div>';
    }

    /* What it did, in order. One grey summary line that opens into a
       timeline. The chevron is drawn whether or not the cursor is on it: a
       trace that only admits to being a control once hovered is the most
       interesting part of an answer hidden behind the least likely gesture. */
    function traceHTML(turn, i) {
      const tools = turn.tools || [];
      if (!tools.length) return '';
      const open = !!turn.traceOpen;
      const kinds = [];
      tools.forEach(t => { const verb = String(t).split(' ')[0]; if (kinds.indexOf(verb) < 0) kinds.push(verb); });
      const summary = tools.length + (tools.length === 1 ? ' step · ' : ' steps · ') +
        kinds.slice(0, 4).join(', ') + (kinds.length > 4 ? '…' : '');
      return '<div class="aic-trace' + (open ? ' aic-open' : '') + '">' +
        '<button type="button" class="aic-tracehead" data-turn="' + i + '">' +
          '<span class="aic-twist">' + (open ? '⌄' : '›') + '</span>' + esc(summary) +
        '</button>' +
        (open ? '<ol class="aic-timeline">' +
          tools.map(t => '<li><span class="aic-tick"></span>' + esc(t) + '</li>').join('') +
          '</ol>' : '') +
        '</div>';
    }

    function startTicker() {
      if (runTicker) return;
      runTicker = setInterval(() => {
        if (!liveRuns().length) { clearInterval(runTicker); runTicker = null; return; }
        const run = currentRun();
        if (run && run.running && dom) {
          const el = dom.status.querySelector('.aic-clock');
          if (el) el.textContent = Math.round((Date.now() - run.started) / 1000) + 's';
        }
      }, 1000);
    }

    function handleRunEvent(run, turn, line) {
      let d;
      try { d = JSON.parse(line); } catch (err) { return; }
      if (d.type === 'board_start') {
        run.cwd = d.cwd || ''; run.home = d.home || ''; run.status = 'thinking';
        return;
      }
      if (d.type === 'board_error') {
        turn.error = d.text || 'the run failed';
        if (d.detail) turn.detail = d.detail;
        return;
      }
      if (d.type === 'system' && d.subtype === 'init') {
        // The first thing the CLI says, and the moment this becomes a session
        // with a name rather than something in flight.
        if (d.session_id && d.session_id !== run.session) {
          run.session = d.session_id;
          if (current && current.owner === run.owner && !current.session) current.session = d.session_id;
          loadSessions();
        }
        return;
      }
      if (d.type === 'assistant' && d.message) {
        (d.message.content || []).forEach(b => {
          if (b.type === 'text' && b.text) {
            // Blocks of one message arrive as separate events sharing an id,
            // and an id can come round again. Keyed on both so nothing doubles.
            const seenKey = (d.message.id || '') + '|' + b.text;
            if (run.seen[seenKey]) return;
            run.seen[seenKey] = 1;
            turn.reply += (turn.reply ? '\n\n' : '') + b.text;
            run.status = 'writing';
          } else if (b.type === 'thinking') {
            run.status = 'thinking';
          } else if (b.type === 'tool_use') {
            turn.tools.push(toolLabel(b.name, b.input, run.cwd));
            run.status = b.name;
          }
        });
        return;
      }
      if (d.type === 'result') {
        // The last word on what the answer was — the streamed blocks were the
        // running commentary, this is the text Claude finished with.
        if (typeof d.result === 'string' && d.result.trim()) turn.reply = d.result;
        if (d.session_id) run.session = d.session_id;
        if (typeof d.total_cost_usd === 'number') { turn.cost = d.total_cost_usd; run.cost += d.total_cost_usd; }
        if (d.is_error && !turn.error) turn.error = 'ended in an error (' + (d.subtype || 'unknown') + ')';
        run.ms = d.duration_ms || (Date.now() - run.started);
        run.status = 'done';
      }
    }

    function finishRun(run) {
      run.running = false;
      run.ctrl = null;
      if (run.status !== 'done') run.status = 'stopped';
      render();
      loadSessions();
      onChange();
    }

    async function startRun(rspec) {
      const run = runs['n' + (++runCounter)] = {
        owner: rspec.owner, key: rspec.key, session: rspec.session || '',
        title: rspec.title || rspec.ask, mode: rspec.mode || 'ask',
        running: true, status: 'starting', cwd: '', home: home(),
        turns: (rspec.turns || []).slice(), started: Date.now(), ms: 0, cost: 0,
        seen: {}, ctrl: new AbortController()
      };
      const turn = { ask: rspec.ask, reply: '', tools: [], error: '', detail: '', cost: 0 };
      run.turns.push(turn);
      if (current && current.owner === run.owner) current.run = run;
      render();
      startTicker();

      let res;
      try {
        res = await fetch(endpoints.run, {
          method: 'POST',
          // The guard header is the point, not the content type: a form
          // cannot set one, so a page on another origin cannot reach the
          // host's helper without a preflight the helper does not answer.
          headers: guardHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            prompt: rspec.ask, mode: run.mode, session: run.session,
            owner: run.key, title: run.title
          }),
          signal: run.ctrl.signal
        });
      } catch (err) {
        turn.error = run.ctrl && run.ctrl.signal.aborted
          ? 'Stopped.' : 'Could not reach the helper — is it still running?';
        return finishRun(run);
      }
      if (!res.ok) {
        let msg = 'The helper refused it (HTTP ' + res.status + ')';
        try { const j = await res.json(); if (j && j.error) msg = j.error; } catch (err) { /* not JSON */ }
        turn.error = msg;
        return finishRun(run);
      }

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buf += dec.decode(chunk.value, { stream: true });
          let nl;
          while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (line) handleRunEvent(run, turn, line);
          }
          render();
        }
      } catch (err) {
        if (run.ctrl && run.ctrl.signal.aborted) { if (!turn.reply) turn.error = 'Stopped.'; }
        else turn.error = 'The answer stopped coming: ' + (err.message || err);
      }
      finishRun(run);
    }

    /* Send from the modal: carries the open conversation on, or starts it. */
    function send() {
      const c = current;
      if (!c) return;
      const box = dom.input;
      const ask = box.value.trim();
      if (!ask) { box.focus(); return; }
      const run = currentRun();
      if (run && run.running) return;
      box.value = '';
      autoGrow(box);
      startRun({
        owner: c.owner, key: c.key, session: c.session, ask,
        // A brand new chat takes its name from the first thing asked in it. A
        // resumed one keeps the name it already has.
        title: (sessionsFor(c.key).find(s => s.id === c.session) || {}).title || chatTitle(ask),
        mode: c.mode || 'ask',
        // Carrying on a conversation read back off disk: the turns already
        // shown stay on screen rather than the modal appearing to start empty.
        turns: run ? run.turns : (c.turns || [])
      });
    }

    async function forget(ownerKey, sessionId) {
      try {
        await fetch(endpoints.forget, {
          method: 'POST',
          headers: guardHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ owner: ownerKey, session: sessionId })
        });
      } catch (err) { /* nothing to do about it */ }
      loadSessions();
    }

    return {
      loadStatus, loadSessions,
      available, status, home,
      sessionsFor, newOwnerKey,
      renderSection,
      openNew, openSession, closeChat, isOpen,
      forget
    };
  }

  global.AIChat = { create: create };
})(typeof window !== 'undefined' ? window : this);
