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
 * The modal follows the claude.ai teardown in ../claude-chat-interface-findings.md
 * — that file is the spec for how this looks and behaves, not background
 * reading, and stays the reference for anyone changing either. What it
 * establishes: attribution by asymmetry (a bubble for you, plain prose for
 * the reply), one slot for the primary action, a status line whose words are
 * the progress. Two things it deliberately does not copy — the trace stays
 * visible rather than waiting for a hover, and the reply keeps a Copy
 * button.
 *
 * Every `AIChat.create()` call is its own instance, independent DOM and all
 * — open several at once (one per card, say) and none of them ever resolves
 * into another's markup. Two option groups beyond the plain modal above:
 *
 *   opts.windowed        drops the fixed, centred, scrim-backed modal for a
 *                         window a host places and moves itself — dragged,
 *                         resized, grown out of a card's own rect via FLIP.
 *                         See growFrom()/setRect()/setZIndex()/setActive()
 *                         and "windowed mode" below create(). This module
 *                         stays incurious about *why* a rect changed; a
 *                         host's grid, its peek mode, its depth order are
 *                         never its concern.
 *   opts.inlineTools,    the richer parts of a full work session's
 *   opts.thinkingGlyphs, transcript — a tool call as a visible pill rather
 *   permission prompts   than something folded into a collapsed trace, the
 *                         CLI's own cycling-glyph indicator instead of a
 *                         plain spinner, and a banner for a pending
 *                         canUseTool decision (Allow / Always allow / Deny)
 *                         answered via transport.answerPermission(). All
 *                         opt-in or additive: a host that asks for none of
 *                         them gets exactly the read-only "ask" modal this
 *                         file has always drawn.
 *   setHeader(),         a header a host names itself: a title, a caption
 *   opts.onRename         line under it, and a state stamped on the box as
 *                         `data-state` for a host stylesheet to pick up.
 *                         For a window attached to something the host knows
 *                         more about than the conversation does — a card, a
 *                         task, a file. Passing `onRename` also makes the
 *                         title editable in place and hands back what was
 *                         typed. A host that calls neither gets the title
 *                         this module derives from the session itself.
 */
(function (global) {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* Code spans first, so a `**bold**` marker sitting inside backticks is
     never mistaken for a real one — same ordering ai_board's Markdown.tsx
     uses, kept deliberately narrow: show what falls outside this subset
     exactly as written rather than guess at it. */
  function mdInline(s) {
    return esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/__([^_]+)__/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])_([^_]+)_/g, '$1<em>$2</em>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>');
  }

  /* Enough markdown for a reply — paragraphs, ordered and unordered lists,
     headings, fenced code. The inline half is mdInline, just above. */
  function mdBlock(text) {
    const lines = String(text).replace(/\r/g, '').split('\n');
    const out = [];
    let para = [], list = null, listTag = 'ul', code = null;
    const flushPara = () => {
      if (para.length) { out.push('<p>' + para.map(mdInline).join('<br>') + '</p>'); para = []; }
    };
    const flushList = () => {
      if (list) { out.push('<' + listTag + '>' + list.map(i => '<li>' + mdInline(i) + '</li>').join('') + '</' + listTag + '>'); list = null; }
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
      const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(l);
      const bullet = ordered || /^\s*[-*•]\s+(.*)$/.exec(l);
      if (bullet) {
        // A change of kind mid-run (bullets into numbers, or back) starts a
        // fresh list rather than mixing markers under one tag.
        const tag = ordered ? 'ol' : 'ul';
        if (list && tag !== listTag) flushList();
        flushPara(); listTag = tag; (list = list || []).push(bullet[1]);
        return;
      }
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

  // The CLI's own spinner frames — see opts.thinkingGlyphs above create().
  const THINKING_GLYPHS = ['·', '✢', '✳', '∗', '✻', '✽', '✻', '∗', '✳', '✢'];
  const THINKING_FRAME_MS = 110;

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

  /* One instance per `create()` call, each with its own DOM subtree — so a
     host opening several at once (one per card, say) never has one
     instance's lookups resolve into another's markup. `uid` only has to be
     unique enough for the one id an ARIA attribute needs to point at
     (`aria-labelledby`); everything else this module looks up by class,
     scoped to the instance's own root element rather than the document. */
  let aicInstances = 0;
  // Shared across every instance on the page, unlike everything else here —
  // document.body is one element no matter how many chats are open, so
  // "is any chat open" has to be counted rather than each instance owning
  // the flag outright. Otherwise closing window B while window A is still
  // open would strip the class a host may be keying off of.
  let aicOpenCount = 0;

  // Windowed mode's geometry constants — see "windowed mode" below
  // create(). Prose stops being readable past roughly 800px; a window
  // narrower than 420 or shorter than 320 stops being usable.
  const WIN_MIN_WIDTH = 420, WIN_MAX_WIDTH = 800, WIN_MIN_HEIGHT = 320, WIN_MARGIN = 24;
  const WIN_MOTION_MS = 260, WIN_EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';
  const WIN_REFLOW_TRANSITION = ['left', 'top', 'width', 'height']
    .map(p => p + ' ' + WIN_MOTION_MS + 'ms ' + WIN_EASING).join(', ');
  function modalHTML(uid) {
    return (
    '<div class="aic-wrap" aria-hidden="true">' +
      '<div class="aic-scrim"></div>' +
      '<section class="aic-box" role="dialog" aria-modal="true" aria-labelledby="' + uid + '-title">' +
        '<header class="aic-head">' +
          '<div class="aic-names">' +
            '<strong id="' + uid + '-title">Chat</strong>' +
            '<span class="aic-for"></span>' +
            // A second caption line, under .aic-for, for a host that has more
            // to say about what this window is attached to than its owner's
            // name — a path, a state, a provenance tag. Empty and hidden
            // unless setHeader() puts something in it. See opts.onRename.
            '<span class="aic-sub aic-hidden"></span>' +
          '</div>' +
          '<a class="aic-btn aic-ghost aic-desktop" href="#" target="_blank" rel="noopener"' +
            ' title="Imports this session into Claude Desktop and carries it on there">Open in Claude</a>' +
          '<button class="aic-btn aic-ghost aic-close" type="button">Close</button>' +
        '</header>' +
        '<div class="aic-status" aria-live="polite"></div>' +
        // Shown between the header and the transcript whenever the run is
        // waiting on a tool decision — see handlePermissionEvent(). Not a
        // status line: it takes an answer rather than reporting progress.
        '<div class="aic-permission aic-hidden">' +
          '<div class="aic-permission-title"></div>' +
          '<p class="aic-permission-detail aic-hidden"></p>' +
          '<div class="aic-permission-buttons">' +
            '<button type="button" class="aic-btn aic-primary" data-permission="allow">Allow</button>' +
            '<button type="button" class="aic-btn aic-ghost aic-hidden" data-permission="allow_always"' +
              ' title="Allow this for the rest of the session, without asking again">Always allow</button>' +
            '<button type="button" class="aic-btn aic-ghost" data-permission="deny">Deny</button>' +
          '</div>' +
        '</div>' +
        '<div class="aic-bodywrap">' +
          '<div class="aic-body"></div>' +
          // Hidden unless a live run has pushed content below what is
          // visible — see updateScrollPill(). Its own row, not inside
          // .aic-body, because that element's innerHTML gets replaced whole
          // on every render.
          '<button type="button" class="aic-scrollpill aic-hidden">New messages ↓</button>' +
        '</div>' +
        '<form class="aic-foot" autocomplete="off">' +
          '<textarea class="aic-input" rows="1" spellcheck="false"></textarea>' +
          '<button class="aic-btn aic-primary aic-send" type="submit">Send</button>' +
          '<button class="aic-btn aic-ghost aic-hidden aic-stop" type="button">Stop</button>' +
        '</form>' +
        // Present in every instance, but only pointer-reachable once
        // `opts.windowed` adds the class that gives them a hit box — see
        // the CSS. A plain modal never binds their handlers either; see
        // wireWindowed() below.
        ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].map(function (edge) {
          return '<div class="aic-grip aic-grip-' + edge + '" data-edge="' + edge + '"></div>';
        }).join('') +
      '</section>' +
    '</div>');
  }

  /* The five calls the widget makes, and nothing else it needs from a host —
     plus one optional sixth. `defaultTransport` below is the HTTP shape
     described in ../README.md — what a host answers if it takes the
     `engine.py` + `http_glue.py` path. A host with no HTTP between the page
     and Claude at all (an Electron renderer talking over IPC, say) skips
     both of those files and passes `opts.transport` instead, implementing
     this same contract however it actually reaches Claude. Only the methods
     given override the default, so a host can replace just `run` and leave
     the rest on fetch.

       status()                        -> Promise<{available, work, cwd, home, model, ...}>
       sessions()                      -> Promise<{chats: {ownerKey: [...]}}>
       transcript(sessionId, cwd)      -> Promise<{turns: [...], toobig}>, each turn
                                           {ask, reply, tools}, OPTIONALLY plus `parts` —
                                           the same content in the order it happened
                                           ({type:'text',text} | {type:'tool',name,input}),
                                           read in preference to reply/tools when present
                                           and non-empty. engine.py sends it; a transport
                                           that doesn't falls back to the old
                                           tools-then-reply approximation, same as a live
                                           run's own fallback for a reply with no streamed
                                           text at all.
       run(payload, signal)            -> AsyncIterable<string>, one stream-json line per
                                           step (an AbortController's signal to honour;
                                           payload is {prompt, mode, session, owner, title}).
                                           Two synthetic line types ride this same stream:
                                           board_start/board_error (see the CLI transport
                                           below) and board_permission — see
                                           "Permission prompts" in ../README.md — a pending
                                           canUseTool-style request the modal shows as a
                                           banner rather than waiting on a click to notice.
       forget(ownerKey, sessionId)     -> Promise<void>
       answerPermission(id, decision)  -> Promise<void>, OPTIONAL. Only called if present —
                                           a backend that never asks a per-tool question
                                           (this repo's engine.py, in both its modes) has
                                           nothing to wire it to, and the banner simply
                                           never appears for it.

     Errors thrown from any of these become the message shown in the modal
     (`run`'s must already be human-readable, since it is shown verbatim), so
     a custom transport should throw new Error('something a person can read')
     rather than let a raw platform error escape. */
  function makeDefaultTransport(endpoints, guard) {
    function guardHeaders(extra) {
      const h = Object.assign({}, extra || {});
      h[guard.name] = guard.value;
      return h;
    }
    return {
      async status() {
        const res = await fetch(endpoints.status + '?t=' + Date.now(), { cache: 'no-store' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      },
      async sessions() {
        const res = await fetch(endpoints.sessions + '?t=' + Date.now(), { cache: 'no-store' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      },
      async transcript(sessionId, cwd) {
        const q = '?session=' + encodeURIComponent(sessionId) + '&cwd=' + encodeURIComponent(cwd || '');
        const res = await fetch(endpoints.transcript + q, { cache: 'no-store' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      },
      async *run(payload, signal) {
        let res;
        try {
          res = await fetch(endpoints.run, {
            method: 'POST',
            // The guard header is the point, not the content type: a form
            // cannot set one, so a page on another origin cannot reach the
            // host's helper without a preflight the helper does not answer.
            headers: guardHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(payload),
            signal
          });
        } catch (err) {
          throw new Error(signal && signal.aborted
            ? 'Stopped.' : 'Could not reach the helper — is it still running?');
        }
        if (!res.ok) {
          let msg = 'The helper refused it (HTTP ' + res.status + ')';
          try { const j = await res.json(); if (j && j.error) msg = j.error; } catch (err) { /* not JSON */ }
          throw new Error(msg);
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
              if (line) yield line;
            }
          }
        } catch (err) {
          throw new Error('The answer stopped coming: ' + (err.message || err));
        }
      },
      async forget(ownerKey, sessionId) {
        await fetch(endpoints.forget, {
          method: 'POST',
          headers: guardHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ owner: ownerKey, session: sessionId })
        });
      },
      // Optional — only present on the default transport if a host wires
      // `endpoints.permission`. A host whose backend never asks a per-tool
      // question (ask mode, or work mode's blanket bypass) has nothing to
      // point it at, and omitting it here is how that stays a no-op rather
      // than every such host needing to say so itself.
      answerPermission: endpoints.permission ? async function (requestId, decision) {
        await fetch(endpoints.permission, {
          method: 'POST',
          headers: guardHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ requestId: requestId, decision: decision })
        });
      } : undefined
    };
  }

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
    const transport = Object.assign(makeDefaultTransport(endpoints, guard), opts.transport || {});
    const isLocked = opts.isLocked || function () { return false; };
    const onChange = opts.onChange || function () {};
    const onSessionsChanged = opts.onSessionsChanged || function () {};
    const onStatusChanged = opts.onStatusChanged || function () {};
    // Fired the instant a message leaves the box — before the run starts, let
    // alone replies — so a host can react to "this conversation just began"
    // without waiting on a reply or polling the session list. `session` is
    // empty on a brand new conversation's first message and set on every send
    // after that, which is the only reliable way to tell the two apart from
    // outside.
    const onSend = opts.onSend || function () {};
    const placeholder = opts.placeholder || 'Ask Claude…';
    // Off for a host that already *is* a Claude client — the button would
    // just point back at itself, or at a session the host no longer tracks.
    const desktopLink = opts.desktopLink !== false;
    // `!= null` rather than `||`: a host passing '' to drop the line entirely
    // is a real choice, not a missing option, and `||` would silently treat
    // that empty string the same as never having passed one at all.
    const readOnlyHelp = opts.readOnlyHelp != null ? opts.readOnlyHelp :
      'Each one runs on this machine and reads only. They are kept apart on purpose — ' +
      'one conversation per question stays short enough to be worth coming back to.';
    // Renders each tool call as a pill inline, where it happened, instead of
    // collapsing the turn's tools into the trace at the end — closer to a
    // full work session's transcript than a short answer's. Off by default:
    // the collapsed trace is still the right call for a quick, mostly-text
    // "ask" conversation, which is what most hosts of this widget are.
    const inlineTools = !!opts.inlineTools;
    // A window this module knows nothing about placing: no default position
    // of its own, no opinion on why a new rect arrived, no share of the
    // Escape key beyond the one flag below. See setRect/setZIndex/setActive.
    // A plain host that never calls any of the three gets exactly today's
    // fixed, centred modal.
    const windowed = !!opts.windowed;
    // A full-viewport dimming layer is right for one centred modal and
    // wrong for several windows scattered across a canvas — off by default
    // once windowed, on by default otherwise. `opts.scrim` overrides either
    // way, same `!= null` reasoning as readOnlyHelp above: a host turning it
    // off deliberately is a real choice to respect, not the same as never
    // having said anything.
    const showScrim = opts.scrim != null ? !!opts.scrim : !windowed;
    const onRectLive = opts.onRectLive || function () {};
    const onRectChange = opts.onRectChange || function () {};
    const onFocus = opts.onFocus || function () {};
    // Off by default so an existing host's status line looks exactly as it
    // always has; on trades the plain spinning ring for the CLI's own
    // cycling-glyph indicator, modelled on the Claude apps' CSS rather than
    // a copied asset (there is no asset — the apps draw this too).
    const thinkingGlyphs = !!opts.thinkingGlyphs;
    // A host that names the window itself — see setHeader() and the header
    // block in render(). Supplying `onRename` is also what makes the title
    // editable in place: without it the title is a label, with it the same
    // element takes a double-click and hands back what was typed. A host
    // that never calls setHeader() gets the title this module has always
    // derived from the session itself.
    const onRename = typeof opts.onRename === 'function' ? opts.onRename : null;
    // What kind of conversation this host opens. `ask` — read-only — is the
    // default and what every host of this widget was until now. A host whose
    // sessions can write says `work` once here rather than per conversation,
    // and the status line stops telling people Claude is only reading.
    const defaultMode = opts.mode === 'work' ? 'work' : 'ask';

    let claudeStatus = null;
    let chatsIndex = {};
    const runs = {};
    let runCounter = 0;
    let current = null;   // the open chat, or null when the modal is closed
    let runTicker = null;
    let dom = null;
    // Only the active instance's Escape closes it — with several windows
    // open at once, a host arms exactly one at a time via setActive(). A
    // single-modal host never calls it, so this stays true and Escape works
    // exactly as it always has.
    let activeFlag = true;
    // What a host has said this window is, or null while it has said nothing
    // — see setHeader(). Held apart from `current` because it outlives any one
    // conversation: the thing the window is attached to does not change when
    // the session inside it does.
    let header = null;
    // Kept so destroy() can take them off window again — an instance created
    // per card, and torn down with it, must not leave listeners or markup
    // behind. See destroy().
    let onWindowKeydown = null;
    let winMoveBound = null, winUpBound = null;
    // True only while the title is being edited, so a render mid-edit does not
    // overwrite what is being typed.
    let renaming = false;
    let originRect = null;   // set by growFrom(); consumed once, on next open
    let growOrigin = null;   // the rect last grown from, reused to shrink back into on close
    let winRect = null;      // current on-screen rect, windowed mode only
    let winDrag = null;      // in-progress move/resize, windowed mode only
    let winClosing = false;  // true for the length of the close animation, so a second click can't restart it
    const uid = 'aic' + (++aicInstances);

    function mount() {
      if (dom) return;
      const holder = document.createElement('div');
      holder.innerHTML = modalHTML(uid);
      const root = holder.firstElementChild;
      document.body.appendChild(root);
      // Scoped to this instance's own subtree throughout, not
      // document.getElementById — two instances open at once must never
      // resolve into each other's markup.
      const $ = sel => root.querySelector(sel);
      dom = {
        root: root,
        wrap: root,
        box: $('.aic-box'),
        head: $('.aic-head'),
        scrim: $('.aic-scrim'),
        title: $('.aic-names strong'),
        forLine: $('.aic-for'),
        subLine: $('.aic-sub'),
        desktop: $('.aic-desktop'),
        close: $('.aic-close'),
        status: $('.aic-status'),
        permission: $('.aic-permission'),
        permissionTitle: $('.aic-permission-title'),
        permissionDetail: $('.aic-permission-detail'),
        body: $('.aic-body'),
        scrollPill: $('.aic-scrollpill'),
        foot: $('.aic-foot'),
        input: $('.aic-input'),
        send: $('.aic-send'),
        stop: $('.aic-stop'),
        grips: root.querySelectorAll('.aic-grip')
      };
      dom.input.placeholder = placeholder;
      if (!showScrim) dom.scrim.classList.add('aic-hidden');
      dom.close.onclick = closeChat;
      dom.scrim.onclick = closeChat;
      dom.foot.onsubmit = e => { e.preventDefault(); send(); };
      dom.stop.onclick = () => { const run = currentRun(); if (run && run.ctrl) run.ctrl.abort(); };
      dom.permission.addEventListener('click', e => {
        const btn = e.target.closest('[data-permission]');
        if (btn) answerPermission(btn.dataset.permission);
      });
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
      // Escape closes the chat before it closes whatever is behind it — but
      // only when this instance is the one the host says is on top, and never
      // while the title is being renamed, where Escape means "put the old
      // name back". This listener captures, so it runs before the title's own
      // handler and has to check rather than be stopped by it.
      onWindowKeydown = function (e) {
        if (e.key === 'Escape' && current && activeFlag && !renaming) {
          e.stopPropagation();
          closeChat();
        }
      };
      window.addEventListener('keydown', onWindowKeydown, true);
      wireRename();
      if (windowed) wireWindowed();
    }

    /* ---- windowed mode: a window a host places, rather than a fixed,
       centred modal ----

       Everything below only runs when `opts.windowed` is true, and this
       module stays deliberately incurious about the reason a rect changed:
       a saved position, a grid cell among several open windows, a peeked
       spot at the screen's edge — all of it is setRect()'s problem to have
       decided, never this file's. What stays here is the FLIP grow/shrink
       (so the thing a click opened and the window it becomes read as the
       same object), dragging and resizing, and reporting rect changes so a
       host can save or reflow around them. What does NOT stay here: where a
       window starts out, its place in any shared depth order, and whether
       Escape is this window's to answer — a host with several windows open
       decides all three; see setZIndex/setActive. */

    function prefersReducedMotion() {
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    }

    /* Opens near the middle at a readable width, never wider than the cap —
       used the first time a window opens with no saved rect to restore. */
    function defaultWinRect() {
      const width = Math.min(WIN_MAX_WIDTH, window.innerWidth - WIN_MARGIN * 2);
      const height = Math.min(680, window.innerHeight - WIN_MARGIN * 2 - 40);
      return {
        x: Math.round((window.innerWidth - width) / 2),
        y: Math.round((window.innerHeight - height) / 2) + 12,
        width: width, height: height
      };
    }

    /* Keeps a window on screen and within its size limits — applied to the
       end state of a local drag or resize. Never applied to a rect a host
       hands in through setRect(): a peeked window is deliberately placed
       mostly off-screen, which is exactly what this exists to prevent. */
    function clampWinRect(rect) {
      const width = Math.max(WIN_MIN_WIDTH, Math.min(WIN_MAX_WIDTH, rect.width));
      const height = Math.max(WIN_MIN_HEIGHT, rect.height);
      return {
        width: width,
        height: Math.min(height, window.innerHeight - WIN_MARGIN),
        // At least a slice of the header stays reachable on every edge, so a
        // window can always be dragged back rather than lost off screen.
        x: Math.max(-width + 120, Math.min(rect.x, window.innerWidth - 120)),
        y: Math.max(38, Math.min(rect.y, window.innerHeight - 60))
      };
    }

    /* The one place a rect actually lands on the element. `immediate` turns
       the reflow transition off — used while a local drag is live, so the
       window tracks the pointer with no lag, and for the very first
       placement, so a freshly opened window never visibly slides in from
       wherever the previous one happened to be. */
    function applyRect(rect, immediate) {
      winRect = rect;
      if (!dom || !dom.box) return;
      const box = dom.box;
      box.style.left = rect.x + 'px';
      box.style.top = rect.y + 'px';
      box.style.width = rect.width + 'px';
      box.style.height = rect.height + 'px';
      box.style.transition = (immediate || winDrag) ? 'none' : WIN_REFLOW_TRANSITION;
    }

    function wireWindowed() {
      dom.wrap.classList.add('aic-windowed');
      // Any pointerdown anywhere in the window brings it to the front,
      // including one that goes on to start a drag — captured ahead of the
      // drag/resize handlers below rather than raised by them, so a host
      // never has to guess whether a given gesture counts as a focus.
      dom.box.addEventListener('pointerdown', onFocus, true);
      dom.head.addEventListener('pointerdown', e => startWinDrag('move', e));
      // A pointerdown that lands on a header button is a click on that
      // button, never the start of a drag.
      [dom.close, dom.desktop, dom.stop].forEach(el => {
        if (el) el.addEventListener('pointerdown', e => e.stopPropagation());
      });
      dom.grips.forEach(g => g.addEventListener('pointerdown', e => startWinDrag(g.dataset.edge, e)));
      winMoveBound = onWinMove;
      winUpBound = onWinUp;
      window.addEventListener('pointermove', winMoveBound);
      window.addEventListener('pointerup', winUpBound);
    }

    function startWinDrag(kind, e) {
      if (!winRect) return;
      e.preventDefault();
      winDrag = { kind: kind, startX: e.clientX, startY: e.clientY, origin: Object.assign({}, winRect) };
    }

    // Move and resize share one handler so the window keeps following the
    // cursor even when the pointer outruns the panel.
    function onWinMove(e) {
      if (!winDrag) return;
      const dx = e.clientX - winDrag.startX;
      const dy = e.clientY - winDrag.startY;
      const o = winDrag.origin;
      let next;
      if (winDrag.kind === 'move') {
        next = clampWinRect({ x: o.x + dx, y: o.y + dy, width: o.width, height: o.height });
      } else {
        next = Object.assign({}, o);
        const k = winDrag.kind;
        if (k.indexOf('e') >= 0) next.width = o.width + dx;
        if (k.indexOf('s') >= 0) next.height = o.height + dy;
        if (k.indexOf('w') >= 0) {
          // Growing leftwards moves the origin, but only as far as the
          // minimum width allows, or the panel would slide while refusing
          // to shrink.
          const width = Math.max(WIN_MIN_WIDTH, Math.min(WIN_MAX_WIDTH, o.width - dx));
          next.x = o.x + (o.width - width);
          next.width = width;
        }
        if (k.indexOf('n') >= 0) {
          const height = Math.max(WIN_MIN_HEIGHT, o.height - dy);
          next.y = o.y + (o.height - height);
          next.height = height;
        }
        next = clampWinRect(next);
      }
      applyRect(next, true);
      onRectLive(next);
    }

    function onWinUp() {
      if (!winDrag) return;
      winDrag = null;
      // The rect itself is already final from the last move; only the
      // transition needs restoring, so a later programmatic setRect() call
      // (a grid reflow, say) glides there instead of jumping.
      if (dom && dom.box) dom.box.style.transition = WIN_REFLOW_TRANSITION;
      if (winRect) onRectChange(winRect);
    }

    /* Grows the panel out of `rect` (viewport coordinates — a DOMRect or the
       same shape) rather than having it appear over it, so the thing a click
       opened and the window it becomes read as the same object. Skipped
       under prefers-reduced-motion, where the window just appears. */
    function growFromRect(rect) {
      const el = dom.box;
      if (!el || prefersReducedMotion()) return;
      const to = el.getBoundingClientRect();
      if (!to.width || !to.height) return;
      const sx = rect.width / to.width, sy = rect.height / to.height;
      const tx = rect.left - to.left, ty = rect.top - to.top;
      el.animate([
        { transform: 'translate(' + tx + 'px,' + ty + 'px) scale(' + sx + ',' + sy + ')', opacity: 0.5 },
        { transform: 'translate(0,0) scale(1,1)', opacity: 1 }
      ], { duration: WIN_MOTION_MS, easing: WIN_EASING, fill: 'both' });
    }

    /* The close half of the same FLIP move, played backwards — one curve,
       one duration, for both directions, so closing is not a different
       gesture. A backstop timer means a cancelled or unsettled animation
       still lets the window go rather than becoming a trap. */
    function closeWindowed() {
      winClosing = true;
      const el = dom && dom.box;
      if (!el || !growOrigin || prefersReducedMotion()) { finishClose(); return; }
      const from = el.getBoundingClientRect();
      const rect = growOrigin;
      const sx = rect.width / from.width, sy = rect.height / from.height;
      const tx = rect.left - from.left, ty = rect.top - from.top;
      let done = false;
      const finish = () => { if (done) return; done = true; finishClose(); };
      const anim = el.animate([
        { transform: 'translate(0,0) scale(1,1)', opacity: 1 },
        { transform: 'translate(' + tx + 'px,' + ty + 'px) scale(' + sx + ',' + sy + ')', opacity: 0.5 }
      ], { duration: WIN_MOTION_MS, easing: WIN_EASING, fill: 'both' });
      anim.onfinish = finish;
      anim.oncancel = finish;
      setTimeout(finish, WIN_MOTION_MS + 150);
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

    async function loadStatus() {
      try {
        const cfg = await transport.status();
        claudeStatus = (cfg && cfg.available) ? cfg : null;
        onStatusChanged(claudeStatus);
        if (claudeStatus) loadSessions();
      } catch (err) { /* no endpoint, no buttons, no complaint */ }
    }

    async function loadSessions() {
      try {
        const data = await transport.sessions();
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
       own page — a task drawer, a sidebar, wherever. `spec.collapsible` wraps
       it in a native <details> instead of a plain <div>, with the label as
       the <summary> — for a host whose list of chats can run long enough to
       be worth putting away. `spec.collapsed` sets the initial state; the
       host owns remembering it (a data-collapse attribute is left on the
       wrapper for the host's own delegated toggle listener to key off), this
       module has no storage of its own to keep that in. Existing callers that
       pass neither option get exactly the plain <div> they always did. */
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
          (desktopLink ? '<a class="aic-icon" href="' + desktopHref(s.id) + '"' +
            ' title="Open this conversation in Claude Desktop">Open in Claude</a>' : '') +
          '<button type="button" class="aic-icon aic-forget" data-session="' + esc(s.id) + '"' +
            ' data-key="' + esc(key) + '" title="Take it off this list. The transcript itself is left alone.">×</button>' +
        '</div>';
      }).join('');
      const labelHTML = esc(label) + (rows.length ? ' <em class="aic-sublabel">' + rows.length + '</em>' : '');
      const body = (list || '<p class="aic-none">No conversations yet.</p>') +
        '<button type="button" class="aic-addsub" data-owner="' + esc(ownerId) + '">+ New chat</button>' +
        // '' really does drop the line — not just its text, the element too, so
        // a host that explained this itself elsewhere doesn't leave a blank
        // .aic-help block sitting under the button for nothing.
        (readOnlyHelp ? '<span class="aic-help">' +
          esc(readOnlyHelp.replace('this machine', home() ? 'this machine, in ' + home() : 'this machine')) +
          '</span>' : '');
      if (!spec.collapsible) return '<div class="aic-field"><span>' + labelHTML + '</span>' + body + '</div>';
      return '<details class="aic-field aic-collapse"' + (spec.collapsed ? '' : ' open') +
        (spec.collapseKey ? ' data-collapse="' + esc(spec.collapseKey) + '"' : '') + '>' +
        '<summary>' + labelHTML + '</summary>' + body + '</details>';
    }

    /* ---- The modal ---- */

    function isOpen() { return !!current; }

    function openInternal(ownerId, ownerKey, sessionId, seed) {
      mount();
      current = { owner: ownerId, key: ownerKey, session: sessionId || '', seed: seed || '',
                  mode: defaultMode,
                  turns: null, loading: false, run: runFor(sessionId) };
      dom.wrap.classList.add('aic-on');
      dom.wrap.setAttribute('aria-hidden', 'false');
      aicOpenCount++;
      document.body.classList.add('aic-chatting');
      if (windowed) applyRect(winRect || defaultWinRect(), true);
      render();
      if (sessionId && !runFor(sessionId)) loadTranscript(sessionId);
      setTimeout(() => { if (dom.input) dom.input.focus(); }, 60);
      if (windowed && originRect) { growOrigin = originRect; growFromRect(originRect); }
      originRect = null;   // consumed — the next open starts plain unless growFrom() is called again
    }
    /* A brand new conversation, or one seeded with a prompt but not sent —
       seeded runs still have a [placeholder] in them sometimes, and firing on
       open would send it before anyone had a chance to fill it in. */
    function openNew(ownerId, ownerKey, seed) { openInternal(ownerId, ownerKey, '', seed || ''); }
    function openSession(ownerId, ownerKey, sessionId) { openInternal(ownerId, ownerKey, sessionId, ''); }

    function closeChat() {
      if (windowed && current && !winClosing) { closeWindowed(); return; }
      if (!winClosing) finishClose();
    }
    function finishClose() {
      current = null;
      winClosing = false;
      if (dom) {
        dom.wrap.classList.remove('aic-on');
        dom.wrap.setAttribute('aria-hidden', 'true');
      }
      aicOpenCount = Math.max(0, aicOpenCount - 1);
      if (aicOpenCount === 0) document.body.classList.remove('aic-chatting');
      onChange();
    }

    async function loadTranscript(sessionId) {
      const c = current;
      if (!c) return;
      c.loading = true;
      render();
      const row = sessionsFor(c.key).find(s => s.id === sessionId);
      try {
        const data = await transport.transcript(sessionId, (row && row.cwd) || '');
        if (!current || current.session !== sessionId) return;
        current.turns = data.toobig ? [] : data.turns.map(t => {
          const tools = (t.tools || []).map(x => toolLabel(x.name, x.input, (row && row.cwd) || ''));
          // `parts` is `reply`/`tools` again, but in the order Claude
          // actually produced them — optional, since it's a newer field
          // than `reply`/`tools` and not every backend sends it yet (see
          // ../README.md's transcript() contract). Read it when a backend
          // does; fall back to the old tools-then-text approximation
          // otherwise, same as a live run's own fallback for "no streamed
          // text at all" further down in handleRunEvent.
          const flow = (Array.isArray(t.parts) && t.parts.length)
            ? t.parts.map(p => p.type === 'tool'
                ? { kind: 'tool', label: toolLabel(p.name, p.input, (row && row.cwd) || '') }
                : { kind: 'text', text: p.text || '' })
            : tools.map(label => ({ kind: 'tool', label: label })).concat(t.reply ? [{ kind: 'text', text: t.reply }] : []);
          return { ask: t.ask, reply: t.reply, error: '', cost: 0, tools: tools, flow: flow };
        });
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

    /* ---- the header a host names itself ------------------------------
       Three things a host may know about this window that the session
       inside it does not: what to call it, what to say under that, and
       what state the thing it is attached to is in. All optional; a host
       that never calls setHeader() sees none of this and gets the header
       this module has always drawn. */

    /** Paints title, caption and state class. `derived` is the name this
        module worked out for itself, used whenever a host has offered
        none. */
    function paintHeader(derived) {
      if (!dom) return;
      // Never while the title is being edited: a render mid-edit would
      // overwrite what is being typed, cursor and all.
      if (!renaming) {
        dom.title.textContent = (header && header.title) || derived || 'Chat';
      }
      const sub = (header && header.subtitle) || '';
      dom.subLine.textContent = sub;
      dom.subLine.classList.toggle('aic-hidden', !sub);
      // One class rather than a set, so a host restyles the frame by state
      // without this module having any opinion on what the states are.
      const state = (header && header.runState) || '';
      if (dom.box.dataset.state !== state) dom.box.dataset.state = state;
    }

    /**
     * What this window is attached to, in a host's own words.
     *
     * `{title, subtitle, runState}`, all optional. Called as often as the
     * host likes — a card whose name, folder or state changed repaints
     * through here rather than by reopening anything.
     */
    function setHeader(spec) {
      header = spec || null;
      paintHeader(null);
    }

    /** Double-click the title to rename, Enter or blur to commit, Escape to
        put it back. Only wired when a host passed `onRename`. */
    function wireRename() {
      if (!onRename || !dom) return;
      const el = dom.title;
      el.title = 'Double-click to rename';
      el.addEventListener('dblclick', () => {
        renaming = true;
        el.contentEditable = 'true';
        el.spellcheck = false;
        el.focus();
        const sel = window.getSelection();
        if (sel && sel.selectAllChildren) sel.selectAllChildren(el);
      });
      // A drag on the header must not start from inside a title being
      // edited, or selecting a word would move the window instead.
      el.addEventListener('pointerdown', e => { if (renaming) e.stopPropagation(); });
      el.addEventListener('keydown', e => {
        if (e.key !== 'Enter' && e.key !== 'Escape') return;
        e.preventDefault();
        // Stops the window-level handler reading this Escape as "close me".
        e.stopPropagation();
        if (e.key === 'Escape') el.textContent = (header && header.title) || '';
        el.blur();
      });
      el.addEventListener('blur', () => {
        renaming = false;
        el.contentEditable = 'false';
        const next = (el.textContent || '').trim();
        const was = (header && header.title) || '';
        if (next && next !== was) onRename(next);
        else el.textContent = was;
      });
    }

    function render() {
      const c = current;
      if (!c || !dom) return;
      const run = currentRun();
      const row = sessionsFor(c.key).find(s => s.id === c.session);

      paintHeader((row && row.title) || (run && run.title) || 'New chat');
      dom.forLine.textContent = (opts.ownerLabel && opts.ownerLabel(c.owner)) || '';

      if (desktopLink && c.session) {
        dom.desktop.href = desktopHref(c.session);
        dom.desktop.classList.remove('aic-hidden');
      } else dom.desktop.classList.add('aic-hidden');

      if (run && run.permission) {
        dom.status.className = 'aic-status aic-live';
        dom.status.innerHTML = '<span class="aic-star"></span><span class="aic-doing">Waiting on your decision</span>';
      } else if (run && run.running) {
        dom.status.className = 'aic-status aic-live';
        dom.status.innerHTML =
          (thinkingGlyphs ? '<span class="aic-star aic-glyph">' + THINKING_GLYPHS[0] + '</span>' : '<span class="aic-star"></span>') +
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

      // The permission banner sits between the header and the transcript,
      // only while a tool decision is pending — see handleRunEvent's
      // board_permission handling and answerPermission() below.
      const permission = run && run.permission;
      dom.permission.classList.toggle('aic-hidden', !permission);
      if (permission) {
        dom.permissionTitle.textContent = permission.title;
        dom.permissionDetail.textContent = permission.description || '';
        dom.permissionDetail.classList.toggle('aic-hidden', !permission.description);
        // Offered only when the run actually gave a rule that would stop it
        // asking again — a real third answer, not Allow wearing a label.
        const always = dom.permission.querySelector('[data-permission="allow_always"]');
        always.classList.toggle('aic-hidden', !permission.canAlwaysAllow);
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
      // Two ways to show what ran: collapsed into one line that opens into a
      // timeline (the default — right for a short "ask" answer), or every
      // call shown where it actually happened (opts.inlineTools — right once
      // tool use is the point of the turn, not a detail of how the answer
      // got made). flowHTML() replaces the reply block entirely in that
      // mode: the text is already in it, in order, alongside the pills.
      const trace = inlineTools ? flowHTML(turn) : traceHTML(turn, i);
      const mineActs = showActs
        ? '<div class="aic-mineacts">' +
            '<button type="button" class="aic-mini" data-copy="' + esc(turn.ask) + '">Copy</button>' +
            '<button type="button" class="aic-mini" data-retry="' + i + '">Retry</button>' +
            '<button type="button" class="aic-mini" data-edit="' + i + '">Edit</button>' +
          '</div>' : '';
      // Non-inlineTools: the one reply block, text and its own Copy button.
      // inlineTools: the text already went out via flowHTML above, so this
      // is just that same Copy button, on its own.
      const reply = inlineTools
        ? (turn.reply ? '<div class="aic-acts"><button type="button" class="aic-copy" data-copy="' +
            esc(turn.reply) + '">Copy</button></div>' : '')
        : (turn.reply ? '<div class="aic-reply">' + mdBlock(turn.reply) +
            '<div class="aic-acts"><button type="button" class="aic-copy" data-copy="' +
            esc(turn.reply) + '">Copy</button></div></div>' : '');
      const err = turn.error
        ? '<p class="aic-err">' + esc(turn.error) +
          (turn.detail ? '<em>' + esc(turn.detail) + '</em>' : '') + '</p>' : '';
      return '<div class="aic-turn">' +
        '<div class="aic-mine"><div class="aic-minewrap">' +
          '<div class="aic-bubble">' + mdInline(turn.ask) + '</div>' + mineActs +
        '</div></div>' +
        trace + reply + err + '</div>';
    }

    /* opts.inlineTools' whole transcript, in the order it happened: text
       segments rendered as markdown prose (the same treatment a plain reply
       gets), tool calls grouped into a pill row wherever they fall in that
       order — not gathered into one block before or after the text. A live
       run builds `turn.flow` as events actually arrive (handleRunEvent); a
       replayed one approximates it (see loadTranscript) since the transport
       contract doesn't carry original ordering. */
    function flowHTML(turn) {
      const flow = turn.flow || [];
      if (!flow.length) return '';
      const out = [];
      let toolRun = null;
      const flushTools = () => { if (toolRun) { out.push(pillsHTML(toolRun)); toolRun = null; } };
      flow.forEach(seg => {
        if (seg.kind === 'tool') { (toolRun = toolRun || []).push(seg.label); }
        // Wrapped in .aic-reply for its typography alone (font size, line
        // height, paragraph spacing) — not for the Copy button that class
        // usually comes with; the one Copy button for the whole turn is
        // added once, after this, by turnHTML.
        else { flushTools(); out.push('<div class="aic-reply">' + mdBlock(seg.text) + '</div>'); }
      });
      flushTools();
      return '<div class="aic-flow">' + out.join('') + '</div>';
    }

    /* One row of tool-call pills. Used by flowHTML for a run of consecutive
       calls with no text between them. */
    function pillsHTML(labels) {
      return '<div class="aic-toolpills">' +
        labels.map(l => '<span class="aic-pill">' + esc(l) + '</span>').join('') +
        '</div>';
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
      if (thinkingGlyphs) startGlyphTicker();
    }

    // A separate, faster interval from the clock above — glyph frames are a
    // different cadence than seconds, and hosts that never turn this on
    // (the default) pay nothing for it.
    let glyphTimer = null, glyphFrame = 0;
    function startGlyphTicker() {
      if (glyphTimer) return;
      glyphTimer = setInterval(() => {
        if (!liveRuns().length) { clearInterval(glyphTimer); glyphTimer = null; return; }
        glyphFrame = (glyphFrame + 1) % THINKING_GLYPHS.length;
        const el = dom && dom.status.querySelector('.aic-glyph');
        if (el) el.textContent = THINKING_GLYPHS[glyphFrame];
      }, THINKING_FRAME_MS);
    }

    function handleRunEvent(run, turn, line) {
      let d;
      try { d = JSON.parse(line); } catch (err) { return; }
      // Any further word from the run means it has moved past waiting,
      // whether or not this module is the thing that answered — a CLI-side
      // rule or the SDK's own "always allow" can resolve one without a
      // click ever happening here.
      if (run.permission && d.type !== 'board_permission') run.permission = null;
      if (d.type === 'board_permission') {
        // A pending canUseTool request the transport is relaying — see
        // ../README.md's "Permission prompts" section for the shape and
        // answerPermission() below for how a click resolves it.
        run.permission = {
          requestId: d.requestId || '', toolName: d.toolName || '',
          title: d.title || 'Claude wants permission',
          description: d.description || '', canAlwaysAllow: !!d.canAlwaysAllow
        };
        run.status = 'needs_you';
        return;
      }
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
            // `flow` is the same content as `reply`/`tools`, kept in arrival
            // order instead of text-then-tools-at-the-end — see
            // opts.inlineTools' flowHTML(), the only thing that reads it.
            turn.flow.push({ kind: 'text', text: b.text });
            run.status = 'writing';
          } else if (b.type === 'thinking') {
            run.status = 'thinking';
          } else if (b.type === 'tool_use') {
            const label = toolLabel(b.name, b.input, run.cwd);
            turn.tools.push(label);
            turn.flow.push({ kind: 'tool', label: label });
            run.status = b.name;
          }
        });
        return;
      }
      if (d.type === 'result') {
        // The last word on what the answer was — the streamed blocks were the
        // running commentary, this is the text Claude finished with. `flow`
        // is left alone: for the CLI this text is virtually always what the
        // streamed blocks already said, and re-diffing against it here risks
        // showing something twice. The one case worth covering is a run that
        // never streamed any text at all (a very fast reply, say) — then
        // there is nothing in `flow` to show without this.
        if (typeof d.result === 'string' && d.result.trim()) {
          turn.reply = d.result;
          if (!turn.flow.some(seg => seg.kind === 'text')) turn.flow.push({ kind: 'text', text: d.result });
        }
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
        running: true, status: 'starting', cwd: '', home: home(), permission: null,
        turns: (rspec.turns || []).slice(), started: Date.now(), ms: 0, cost: 0,
        seen: {}, ctrl: new AbortController()
      };
      const turn = { ask: rspec.ask, reply: '', tools: [], flow: [], error: '', detail: '', cost: 0 };
      run.turns.push(turn);
      if (current && current.owner === run.owner) current.run = run;
      render();
      startTicker();

      try {
        for await (const line of transport.run({
          prompt: rspec.ask, mode: run.mode, session: run.session,
          owner: run.key, title: run.title
        }, run.ctrl.signal)) {
          handleRunEvent(run, turn, line);
          render();
        }
      } catch (err) {
        if (run.ctrl && run.ctrl.signal.aborted) { if (!turn.reply) turn.error = 'Stopped.'; }
        else turn.error = (err && err.message) || String(err);
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
      onSend({ owner: c.owner, key: c.key, session: c.session || '', ask, mode: c.mode || 'ask' });
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

    /* A click on Allow / Always allow / Deny. Cleared locally right away
       rather than waiting on a round trip — the run's own next event would
       clear it anyway (see handleRunEvent), this just avoids a stale banner
       sitting there for the length of one network call. A transport that
       hasn't implemented this call yet (most haven't; it's optional — see
       ../README.md) is a silent no-op instead of a thrown error, since
       there is nothing sensible to show the answer failed against. */
    function answerPermission(decision) {
      const run = currentRun();
      if (!run || !run.permission) return;
      const requestId = run.permission.requestId;
      run.permission = null;
      render();
      if (transport.answerPermission) {
        Promise.resolve(transport.answerPermission(requestId, decision)).catch(() => {});
      }
    }

    async function forget(ownerKey, sessionId) {
      try { await transport.forget(ownerKey, sessionId); } catch (err) { /* nothing to do about it */ }
      loadSessions();
    }

    /* ---- windowed-mode-only public API — no-ops when opts.windowed is
       false, so a plain-modal host (to-dos, say) never has to know these
       exist. ---- */

    // Call before openNew()/openSession(): the FLIP grow-in animates from
    // this rect (a DOMRect, or the same {left,top,width,height} shape — the
    // card's own bounding box, typically) on the open that follows. Not
    // sticky beyond that one open.
    function growFrom(rect) { originRect = rect; }
    // A rect this window did not choose and is not asked to justify: a
    // saved position, a grid cell, a peek target. Ignored while a local
    // drag or resize is live, so a host reflowing other windows never
    // fights the one you're currently dragging.
    function setRect(rect) { if (windowed && rect && !winDrag) applyRect(rect, false); }
    function setZIndex(z) { if (dom) dom.wrap.style.zIndex = z; }
    // Whether this is the window a bare Escape should close — a host with
    // several open at once arms exactly one. A single-modal host never
    // calls this, so it defaults to true and Escape behaves exactly as it
    // always has.
    function setActive(v) { activeFlag = !!v; }

    /**
     * Takes this instance off the page for good: its markup out of the body,
     * its listeners off window, its runs aborted.
     *
     * closeChat() only hides the window, because a plain host opens and
     * closes the same one all day and rebuilding it each time would be
     * waste. A host that creates an instance per thing — one per card, say —
     * needs the other half, or every instance it ever opened stays in the
     * document, still listening, and a `document.querySelector` for anything
     * inside one finds whichever was created first.
     */
    function destroy() {
      Object.keys(runs).forEach(function (id) {
        const run = runs[id];
        if (run && run.ctrl) { try { run.ctrl.abort(); } catch (err) { /* already gone */ } }
        delete runs[id];
      });
      if (runTicker) { clearInterval(runTicker); runTicker = null; }
      if (current) { current = null; aicOpenCount = Math.max(0, aicOpenCount - 1); }
      if (aicOpenCount === 0) document.body.classList.remove('aic-chatting');
      if (onWindowKeydown) { window.removeEventListener('keydown', onWindowKeydown, true); onWindowKeydown = null; }
      if (winMoveBound) { window.removeEventListener('pointermove', winMoveBound); winMoveBound = null; }
      if (winUpBound) { window.removeEventListener('pointerup', winUpBound); winUpBound = null; }
      if (dom && dom.root && dom.root.parentNode) dom.root.parentNode.removeChild(dom.root);
      dom = null;
    }

    return {
      loadStatus, loadSessions,
      available, status, home,
      sessionsFor, newOwnerKey,
      renderSection,
      openNew, openSession, closeChat, isOpen,
      forget,
      growFrom, setRect, setZIndex, setActive, setHeader, destroy
    };
  }

  global.AIChat = { create: create };
})(typeof window !== 'undefined' ? window : this);
