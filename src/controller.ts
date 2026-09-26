import { chatTitle, desktopHref, runDoing, runDoneLabel, toolLabel, whenLabel } from './format';
import { DEFAULT_ENDPOINTS, makeDefaultTransport } from './transport';
import { dockJoin, dockLeave, dockNotify, dockRectFor, dockSubscribe } from './dock';
import type { DockState } from './dock';
import type {
  ChatOptions, ChatStatus, Header, Origin, PermissionDecision, PermissionRequest, Rect,
  SessionRow, SessionsIndex, Transport, Turn,
} from './types';

/* One conversation window's worth of state, and everything that changes it.
   No React and no DOM: a component reads `getSnapshot()` and calls the
   methods, and a test can drive it with a fake transport.

   Three things hold a conversation together and none is a copy of another:

     ownerKey                      which group of sessions this is
     the host's sessions store     which session ids sit under that key
     Claude Code's own .jsonl      what was actually said

   The last one is why this never stores a transcript of its own. That file is
   what the CLI resumes from and what Claude Desktop imports, so a
   conversation carried on anywhere else comes back complete rather than as a
   stale copy.

   "Owner" is this module's word for whatever the host organises conversations
   by: a task id, a ticket number, a note path. An owner can carry more than
   one conversation, because the work on one thing is rarely one
   conversation, and keeping them apart is the point. */

const MOTION_MS = 260;

interface Run {
  owner: string;
  key: string;
  session: string;
  title: string;
  mode: 'ask' | 'work';
  running: boolean;
  status: string;
  cwd: string;
  home: string;
  permission: PermissionRequest | null;
  turns: Turn[];
  started: number;
  ms: number;
  cost: number;
  seen: Record<string, 1>;
  ctrl: AbortController | null;
}

interface Current {
  owner: string;
  key: string;
  session: string;
  seed: string;
  mode: 'ask' | 'work';
  /** Wraps the first message only, then clears. */
  preface: ((ask: string) => string) | null;
  turns: Turn[] | null;
  loading: boolean;
  loadErr?: string;
  toobig?: boolean;
  run: Run | null;
}

export type StatusLine =
  | { kind: 'permission' }
  | { kind: 'running'; doing: string; started: number }
  | { kind: 'text'; text: string };

/** Everything a component draws from, as one immutable-by-convention object. */
export interface ChatView {
  open: boolean;
  /** Increments on every open, so a component can reset what belongs to one conversation. */
  openId: number;
  windowed: boolean;
  owner: string;
  session: string;
  /** What the window is called: the host's name for it if it gave one, otherwise one worked out from the session. */
  title: string;
  ownerLabel: string;
  subtitle: string;
  runState: string;
  desktopHref: string | null;
  status: StatusLine;
  turns: Turn[];
  busy: boolean;
  loading: boolean;
  loadErr: string;
  toobig: boolean;
  home: string;
  permission: PermissionRequest | null;
  placeholder: string;
  inlineTools: boolean;
  thinkingGlyphs: boolean;
  renamable: boolean;
  /** Whether the host asked for the minimise and anchor buttons. */
  dockable: boolean;
  /** Kept in the dock row for good, so it has no close button. */
  pinned: boolean;
  presentation: {
    rect: Rect | null; growFrom: Origin | null; zIndex: number | undefined; active: boolean; peeked: boolean;
    /** Docked to the bottom edge as a bar or a panel, or 'none' for the ordinary modal or window. */
    dock: DockState;
    /** Where the dock row puts it, when docked. */
    dockRect: Rect | null;
  };
}

export class ChatController {
  private readonly opts: ChatOptions;
  private readonly transport: Transport;
  private readonly windowed: boolean;
  private readonly defaultMode: 'ask' | 'work';

  private claudeStatus: ChatStatus | null = null;
  private chatsIndex: SessionsIndex = {};
  private runs: Record<string, Run> = {};
  private runCounter = 0;
  private current: Current | null = null;
  private header: Header | null = null;
  private closing = false;
  private closeTimer: ReturnType<typeof setTimeout> | null = null;
  private openId = 0;
  private originRect: Origin | null = null;
  private growOrigin: Origin | null = null;
  private rect: Rect | null = null;
  private zIndex: number | undefined;
  private active = true;
  private peeked = false;
  private readonly dockable: boolean;
  private readonly pin: boolean;
  private dock: DockState = 'none';
  private unDock: (() => void) | null = null;

  private listeners = new Set<() => void>();
  private snap: ChatView | null = null;

  constructor(opts: ChatOptions = {}) {
    this.opts = opts;
    const endpoints = { ...DEFAULT_ENDPOINTS, ...(opts.endpoints || {}) };
    const guard = { name: 'X-Board', value: '1', ...(opts.guardHeader || {}) };
    this.transport = Object.assign(makeDefaultTransport(endpoints, guard), opts.transport || {});
    this.windowed = !!opts.windowed;
    this.defaultMode = opts.mode === 'work' ? 'work' : 'ask';
    this.dockable = !!opts.dockable;
    this.pin = this.dockable && !!opts.pinned;
    /* Another chat joining or leaving the row moves this one along it. */
    if (this.dockable) this.unDock = dockSubscribe(() => { if (this.dock !== 'none') this.emit(); });
  }

  /* ---- store ---- */

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  };

  getSnapshot = (): ChatView => (this.snap ??= this.build());

  private emit(): void {
    this.snap = null;
    this.listeners.forEach((fn) => fn());
  }

  /* ---- what a host reads ---- */

  available = (): boolean => !!this.claudeStatus && !(this.opts.isLocked?.() ?? false);
  status = (): ChatStatus | null => this.claudeStatus;
  home = (): string => (this.claudeStatus ? String(this.claudeStatus.home ?? '') : '');
  isOpen = (): boolean => !!this.current;

  sessionsFor = (key: string): SessionRow[] => {
    const rows = (key && this.chatsIndex[key]) || [];
    return rows.slice().sort((a, b) => String(b.updated || '').localeCompare(String(a.updated || '')));
  };

  /* Six characters of base36. It means nothing on its own, which is the idea:
     the host says which owner, the sessions store says which conversations sit
     under that key. */
  newOwnerKey = (): string => {
    let key = '';
    do { key = Math.random().toString(36).slice(2, 8); } while (key.length < 6 || this.chatsIndex[key]);
    return key;
  };

  private runFor(sessionId: string): Run | null {
    if (!sessionId) return null;
    const found = Object.values(this.runs).filter((r) => r.session === sessionId);
    return found.length ? found[found.length - 1] : null;
  }

  /* What the window is showing: a live run if there is one, otherwise
     whatever was read back off disk. Never both. A conversation started from
     here holds its run directly, because a new one has no session id until
     the CLI's first line arrives, and looking it up by a session it does not
     have yet would leave the window claiming to be idle while it was already
     working. */
  private currentRun(): Run | null {
    const c = this.current;
    if (!c) return null;
    return c.run || this.runFor(c.session);
  }

  private currentTurns(): Turn[] {
    const c = this.current;
    if (!c) return [];
    const run = this.currentRun();
    return run ? run.turns : c.turns || [];
  }

  /* ---- loading ---- */

  loadStatus = async (): Promise<void> => {
    try {
      const cfg = await this.transport.status();
      this.claudeStatus = cfg && cfg.available ? cfg : null;
      this.opts.onStatusChanged?.(this.claudeStatus);
      if (this.claudeStatus) void this.loadSessions();
    } catch { /* no endpoint, no buttons, no complaint */ }
  };

  loadSessions = async (): Promise<void> => {
    try {
      const data = await this.transport.sessions();
      this.chatsIndex = (data && data.chats) || {};
      this.opts.onSessionsChanged?.(this.chatsIndex);
      if (this.current) this.emit();
      this.opts.onChange?.();
    } catch { /* no helper, no list */ }
  };

  forget = async (ownerKey: string, sessionId: string): Promise<void> => {
    try { await this.transport.forget(ownerKey, sessionId); } catch { /* nothing to do about it */ }
    await this.loadSessions();
  };

  /* ---- opening and closing ---- */

  private openInternal(owner: string, key: string, sessionId: string, seed: string, preface?: (ask: string) => string): void {
    if (this.closeTimer) { clearTimeout(this.closeTimer); this.closeTimer = null; }
    this.closing = false;
    this.current = {
      owner, key, session: sessionId || '', seed: seed || '', mode: this.defaultMode,
      preface: typeof preface === 'function' ? preface : null,
      turns: null, loading: false, run: this.runFor(sessionId),
    };
    this.openId++;
    /* Grown out of the rect the host named, once. The next open starts plain
       unless growFrom() is called again. */
    this.growOrigin = this.windowed ? this.originRect : null;
    this.originRect = null;
    this.emit();
    if (sessionId && !this.runFor(sessionId)) void this.loadTranscript(sessionId);
  }

  /* A brand new conversation, or one seeded with a prompt but not sent:
     seeded runs still have a [placeholder] in them sometimes, and firing on
     open would send it before anyone had a chance to fill it in.
     `preface(ask)` returns what actually goes to Claude on the first message,
     given what was typed. The box still opens on `seed` (usually nothing) and
     the transcript still shows the typed words. */
  openNew = (ownerId: string, ownerKey: string, seed?: string, opts?: { preface?: (ask: string) => string }): void =>
    this.openInternal(ownerId, ownerKey, '', seed || '', opts?.preface);

  openSession = (ownerId: string, ownerKey: string, sessionId: string): void =>
    this.openInternal(ownerId, ownerKey, sessionId, '');

  closeChat = (): void => {
    if (!this.current || this.closing) return;
    /* A pinned chat is never closed by its own button or Escape, only put
       back down as a bar. destroy() still takes it down. */
    if (this.pin) { this.minimise(); return; }
    const animated = this.windowed && !!this.growOrigin
      && !(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
    if (!animated) { this.finishClose(); return; }
    /* The window shrinks back into the rect it grew out of, and only then is
       the conversation closed, so a host that reacts to closing by taking the
       whole instance down does not cut the animation off. */
    this.closing = true;
    this.emit();
    this.closeTimer = setTimeout(() => this.finishClose(), MOTION_MS + 20);
  };

  private finishClose(): void {
    if (this.closeTimer) { clearTimeout(this.closeTimer); this.closeTimer = null; }
    this.leaveDock();
    this.current = null;
    this.closing = false;
    this.emit();
    this.opts.onChange?.();
  }

  private async loadTranscript(sessionId: string): Promise<void> {
    const c = this.current;
    if (!c) return;
    c.loading = true;
    this.emit();
    const row = this.sessionsFor(c.key).find((s) => s.id === sessionId);
    const cwd = (row && row.cwd) || '';
    try {
      const data = await this.transport.transcript(sessionId, cwd);
      if (!this.current || this.current.session !== sessionId) return;
      this.current.turns = data.toobig ? [] : data.turns.map((t): Turn => {
        const tools = (t.tools || []).map((x) => toolLabel(x.name, x.input, cwd));
        /* `parts` is `reply` and `tools` again, in the order Claude actually
           produced them. It is optional, since not every backend sends it
           yet. Read it when one does, and fall back to tools-then-text
           otherwise. */
        const flow: Turn['flow'] = Array.isArray(t.parts) && t.parts.length
          ? t.parts.map((p) => p.type === 'tool'
              ? { kind: 'tool' as const, label: toolLabel(p.name, p.input, cwd) }
              : { kind: 'text' as const, text: p.text || '' })
          : [
              ...tools.map((label) => ({ kind: 'tool' as const, label })),
              ...(t.reply ? [{ kind: 'text' as const, text: t.reply }] : []),
            ];
        return { ask: t.ask, reply: t.reply || '', error: '', detail: '', cost: 0, tools, flow };
      });
      this.current.toobig = !!data.toobig;
    } catch {
      if (this.current) {
        this.current.loadErr =
          'That conversation is not on disk any more — Claude Code keeps the transcripts, and this one has been cleared.';
      }
    }
    if (this.current) { this.current.loading = false; this.emit(); }
  }

  /* ---- running ---- */

  private handleRunEvent(run: Run, turn: Turn, line: string): void {
    let d: any;
    try { d = JSON.parse(line); } catch { return; }
    /* Any further word from the run means it has moved past waiting, whether
       or not this is what answered: a CLI-side rule or the SDK's own "always
       allow" can resolve one without a click ever happening here. */
    if (run.permission && d.type !== 'board_permission') run.permission = null;

    if (d.type === 'board_permission') {
      run.permission = {
        requestId: d.requestId || '', toolName: d.toolName || '',
        title: d.title || 'Claude wants permission',
        description: d.description || '', canAlwaysAllow: !!d.canAlwaysAllow,
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
      /* The first thing the CLI says, and the moment this becomes a session
         with a name rather than something in flight. */
      if (d.session_id && d.session_id !== run.session) {
        run.session = d.session_id;
        if (this.current && this.current.owner === run.owner && !this.current.session) this.current.session = d.session_id;
        void this.loadSessions();
      }
      return;
    }
    if (d.type === 'assistant' && d.message) {
      for (const b of d.message.content || []) {
        if (b.type === 'text' && b.text) {
          /* Blocks of one message arrive as separate events sharing an id, and
             an id can come round again. Keyed on both so nothing doubles. */
          const seenKey = (d.message.id || '') + '|' + b.text;
          if (run.seen[seenKey]) continue;
          run.seen[seenKey] = 1;
          turn.reply += (turn.reply ? '\n\n' : '') + b.text;
          turn.flow.push({ kind: 'text', text: b.text });
          run.status = 'writing';
        } else if (b.type === 'thinking') {
          run.status = 'thinking';
        } else if (b.type === 'tool_use') {
          const label = toolLabel(b.name, b.input, run.cwd);
          turn.tools.push(label);
          turn.flow.push({ kind: 'tool', label });
          run.status = b.name;
        }
      }
      return;
    }
    if (d.type === 'result') {
      /* The last word on what the answer was: the streamed blocks were the
         running commentary, this is the text Claude finished with. `flow` is
         left alone, since for the CLI this is virtually always what the
         streamed blocks already said and re-diffing risks showing something
         twice. The one case worth covering is a run that never streamed any
         text at all, where there is nothing in `flow` to show without this. */
      if (typeof d.result === 'string' && d.result.trim()) {
        turn.reply = d.result;
        if (!turn.flow.some((seg) => seg.kind === 'text')) turn.flow.push({ kind: 'text', text: d.result });
      }
      if (d.session_id) run.session = d.session_id;
      if (typeof d.total_cost_usd === 'number') { turn.cost = d.total_cost_usd; run.cost += d.total_cost_usd; }
      if (d.is_error && !turn.error) turn.error = 'ended in an error (' + (d.subtype || 'unknown') + ')';
      run.ms = d.duration_ms || Date.now() - run.started;
      run.status = 'done';
    }
  }

  private finishRun(run: Run): void {
    run.running = false;
    run.ctrl = null;
    if (run.status !== 'done') run.status = 'stopped';
    this.emit();
    void this.loadSessions();
    this.opts.onChange?.();
  }

  private async startRun(spec: {
    owner: string; key: string; session: string; ask: string; prompt?: string; title: string; mode: 'ask' | 'work'; turns: Turn[];
  }): Promise<void> {
    const run: Run = this.runs['n' + ++this.runCounter] = {
      owner: spec.owner, key: spec.key, session: spec.session || '',
      title: spec.title || spec.ask, mode: spec.mode || 'ask',
      running: true, status: 'starting', cwd: '', home: this.home(), permission: null,
      turns: spec.turns.slice(), started: Date.now(), ms: 0, cost: 0,
      seen: {}, ctrl: new AbortController(),
    };
    /* `ask` is what was written and what the transcript shows; `prompt` is
       what actually goes to Claude. They are the same thing for every send but
       one: the first message of a conversation a host opened with a preface,
       where the host puts the document being discussed in front of the
       sentence. Keeping them apart is what lets the window show the sentence
       rather than the document nobody typed. */
    const turn: Turn = { ask: spec.ask, reply: '', tools: [], flow: [], error: '', detail: '', cost: 0 };
    run.turns.push(turn);
    if (this.current && this.current.owner === run.owner) this.current.run = run;
    this.emit();

    try {
      for await (const line of this.transport.run({
        prompt: spec.prompt || spec.ask, mode: run.mode, session: run.session, owner: run.key, title: run.title,
      }, run.ctrl!.signal)) {
        this.handleRunEvent(run, turn, line);
        this.emit();
      }
    } catch (err) {
      if (run.ctrl && run.ctrl.signal.aborted) { if (!turn.reply) turn.error = 'Stopped.'; }
      else turn.error = (err as Error)?.message || String(err);
    }
    this.finishRun(run);
  }

  /** Send from the window: carries the open conversation on, or starts it. Returns whether anything was sent. */
  send = (text: string): boolean => {
    const c = this.current;
    if (!c) return false;
    const ask = text.trim();
    if (!ask) return false;
    const run = this.currentRun();
    if (run && run.running) return false;
    /* The preface, if the host gave one: it wraps the first message of a new
       conversation and nothing after it, so a host can open a chat about a
       document without pasting the document into the box to scroll past.
       Consumed on use, because by the second message Claude has the
       document. */
    const prompt = c.preface && !c.session ? c.preface(ask) : ask;
    if (c.preface) c.preface = null;
    this.opts.onSend?.({ owner: c.owner, key: c.key, session: c.session || '', ask, prompt, mode: c.mode || 'ask' });
    void this.startRun({
      owner: c.owner, key: c.key, session: c.session, ask, prompt,
      /* A brand new chat takes its name from the first thing asked in it. A
         resumed one keeps the name it already has. */
      title: (this.sessionsFor(c.key).find((s) => s.id === c.session) || {}).title || chatTitle(ask),
      mode: c.mode || 'ask',
      /* Carrying on a conversation read back off disk: the turns already
         shown stay on screen rather than the window appearing to start empty. */
      turns: run ? run.turns : c.turns || [],
    });
    return true;
  };

  stop = (): void => {
    const run = this.currentRun();
    if (run && run.ctrl) run.ctrl.abort();
  };

  /* Retry and Edit only make sense on the last turn. claude.ai can fork a new
     response from any earlier message in the thread; this engine resumes a
     session by appending to it (`--resume`), so there is no way to rewind to
     an earlier point without discarding what came after. Retry resends the
     same words as a new turn, Edit loads them back into the composer to tweak
     first. Both are honest about being that rather than pretending to rewrite
     history. */
  retry = (i: number): void => {
    const c = this.current;
    if (!c) return;
    const turn = this.currentTurns()[i];
    const run = this.currentRun();
    if (!turn || (run && run.running)) return;
    void this.startRun({
      owner: c.owner, key: c.key, session: c.session, ask: turn.ask,
      title: (this.sessionsFor(c.key).find((s) => s.id === c.session) || {}).title || chatTitle(turn.ask),
      mode: c.mode || 'ask',
      turns: run ? run.turns : c.turns || [],
    });
  };

  /** What to put back in the composer for a turn's Edit. */
  editText = (i: number): string => this.currentTurns()[i]?.ask ?? '';

  /* Consumed once per open. A seed only means something on a conversation
     with nothing said in it yet. */
  takeSeed = (): string => {
    const c = this.current;
    if (!c || !c.seed) return '';
    const seed = c.seed;
    c.seed = '';
    return this.currentTurns().length ? '' : seed;
  };

  /* Cleared locally right away rather than waiting on a round trip: the run's
     own next event would clear it anyway, this just avoids a stale banner
     sitting there for the length of one network call. A transport that has not
     implemented the call (it is optional) is a silent no-op instead of a
     thrown error, since there is nothing sensible to show the answer failed
     against. */
  answerPermission = (decision: PermissionDecision): void => {
    const run = this.currentRun();
    if (!run || !run.permission) return;
    const requestId = run.permission.requestId;
    run.permission = null;
    this.emit();
    if (this.transport.answerPermission) {
      Promise.resolve(this.transport.answerPermission(requestId, decision)).catch(() => {});
    }
  };

  /* ---- the header a host names itself ----
     Three things a host may know about this window that the session inside it
     does not: what to call it, what to say under that, and what state the
     thing it is attached to is in. All optional. */

  setHeader = (spec: Header | null): void => { this.header = spec || null; this.emit(); };

  rename = (title: string): void => this.opts.onRename?.(title);

  /* ---- windowed presentation ----
     No-ops unless the host asked for a window, so a plain-modal host never has
     to know these exist. */

  /** Call before openNew()/openSession(): the window grows out of this rect on the open that follows. Not sticky beyond that one open. */
  growFrom = (rect: Origin | DOMRect | Rect | null): void => {
    if (!rect) { this.originRect = null; return; }
    const r = rect as any;
    this.originRect = {
      left: r.left ?? r.x, top: r.top ?? r.y, width: r.width, height: r.height,
    };
  };

  /** A rect this window did not choose and is not asked to justify: a saved position, a grid cell, a peek target. */
  setRect = (rect: Rect | null): void => {
    if (!this.windowed || !rect) return;
    this.rect = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    this.emit();
  };
  setZIndex = (z: number): void => { this.zIndex = z; this.emit(); };
  /** Whether a bare Escape is this window's to answer. */
  setActive = (v: boolean): void => { this.active = !!v; this.emit(); };
  setPeeked = (v: boolean): void => { this.peeked = !!v; this.emit(); };

  /* ---- docked presentation ----
     No-ops unless the host passed `dockable`. A docked chat is still the same
     open conversation: only where and how big it is drawn changes. */

  dockState = (): DockState => this.dock;
  pinned = (): boolean => this.pin;
  /** Whether any conversation this instance started is still running, open or not. */
  running = (): boolean => Object.values(this.runs).some((r) => r.running);

  private setDock(next: DockState): void {
    if (!this.dockable || !this.current || this.dock === next) return;
    const was = this.dock;
    this.dock = next;
    /* Every docked chat hears the row change and redraws, this one included,
       except one that has just left it, which redraws itself. */
    if (next === 'none') { dockLeave(this); this.emit(); }
    else if (was === 'none') dockJoin(this);
    else dockNotify();
  }
  private leaveDock(): void {
    if (this.dock === 'none') return;
    this.dock = 'none';
    dockLeave(this);
  }

  /** Down to a bar on the bottom edge: title, run state, close. */
  minimise = (): void => this.setDock('minimised');
  /** The full chat as a fixed panel on the bottom edge. */
  anchor = (): void => this.setDock('anchored');
  /** Back to the ordinary modal or window. */
  expand = (): void => this.setDock('none');

  rectLive = (r: Rect): void => this.opts.onRectLive?.(r);
  rectChange = (r: Rect): void => {
    this.rect = r;
    this.opts.onRectChange?.(r);
  };
  pressed = (): void => this.opts.onFocus?.();

  destroy = (): void => {
    for (const id of Object.keys(this.runs)) {
      const run = this.runs[id];
      if (run && run.ctrl) { try { run.ctrl.abort(); } catch { /* already gone */ } }
      delete this.runs[id];
    }
    if (this.closeTimer) { clearTimeout(this.closeTimer); this.closeTimer = null; }
    this.leaveDock();
    this.unDock?.();
    this.unDock = null;
    this.current = null;
    this.closing = false;
    this.listeners.clear();
  };

  /* ---- the view ---- */

  private build(): ChatView {
    const c = this.current;
    const run = this.currentRun();
    const row = c ? this.sessionsFor(c.key).find((s) => s.id === c.session) : undefined;
    const derived = (row && row.title) || (run && run.title) || 'New chat';
    const busy = !!(run && run.running);

    let status: StatusLine;
    if (!c) status = { kind: 'text', text: '' };
    else if (run && run.permission) status = { kind: 'permission' };
    else if (run && run.running) status = { kind: 'running', doing: runDoing(run.status), started: run.started };
    else if (run) {
      status = { kind: 'text', text: (run.mode === 'work' ? 'Claude, working in ' : 'Claude, reading in ') + (run.home || '') + ' · ' + runDoneLabel(run) };
    } else if (c.loading) status = { kind: 'text', text: 'Reading the transcript…' };
    else if (c.session) status = { kind: 'text', text: 'Earlier conversation · ' + ((row && whenLabel(row.updated)) || '') };
    else status = { kind: 'text', text: 'New conversation in ' + this.home() + ' · ' + (c.mode === 'work' ? 'can write' : 'reads only') };

    return {
      open: !!c && !this.closing,
      openId: this.openId,
      windowed: this.windowed,
      owner: c?.owner ?? '',
      session: c?.session ?? '',
      title: (this.header && this.header.title) || derived,
      ownerLabel: (c && this.opts.ownerLabel?.(c.owner)) || '',
      subtitle: (this.header && this.header.subtitle) || '',
      runState: (this.header && this.header.runState) || '',
      desktopHref: this.opts.desktopLink !== false && c && c.session ? desktopHref(c.session) : null,
      status,
      turns: this.currentTurns().map((t) => ({ ...t, tools: t.tools.slice(), flow: t.flow.slice() })),
      busy,
      loading: !!c?.loading,
      loadErr: c?.loadErr ?? '',
      toobig: !!c?.toobig,
      home: this.home(),
      permission: run && run.permission ? { ...run.permission } : null,
      placeholder: this.opts.placeholder || 'Ask Claude…',
      inlineTools: !!this.opts.inlineTools,
      thinkingGlyphs: !!this.opts.thinkingGlyphs,
      renamable: typeof this.opts.onRename === 'function',
      dockable: this.dockable,
      pinned: this.pin,
      presentation: {
        rect: this.rect, growFrom: this.growOrigin, zIndex: this.zIndex, active: this.active, peeked: this.peeked,
        dock: this.dock, dockRect: this.dock === 'none' ? null : dockRectFor(this),
      },
    };
  }
}
