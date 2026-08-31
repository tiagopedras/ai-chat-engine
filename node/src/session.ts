import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import {
  getSessionInfo,
  getSessionMessages,
  query,
  type Options,
  type PermissionResult,
  type PermissionUpdate,
  type Query,
  type SDKMessage,
  type SDKUserMessage
} from '@anthropic-ai/claude-agent-sdk'
import type { PendingPermission, RunState, SessionCard, TranscriptEntry } from './types.js'
import { explainAuthFailure, isAuthFailure } from './auth.js'
import { describe, describeTool } from './describeTool.js'
import { unwrapSlashCommand } from './slashCommand.js'

/**
 * A queue that presents itself as an async iterable, so the SDK can consume
 * prompts from it while a host pushes new ones in. This is what keeps a
 * session alive between turns: `query()` stays parked on the iterator
 * rather than finishing after one exchange.
 */
class PromptQueue implements AsyncIterable<SDKUserMessage> {
  private pending: SDKUserMessage[] = []
  private waiting: ((value: IteratorResult<SDKUserMessage>) => void) | null = null
  private closed = false

  push(text: string): void {
    if (this.closed) return
    const message: SDKUserMessage = {
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null
    }
    if (this.waiting) {
      const resolve = this.waiting
      this.waiting = null
      resolve({ value: message, done: false })
    } else {
      this.pending.push(message)
    }
  }

  close(): void {
    this.closed = true
    if (this.waiting) {
      const resolve = this.waiting
      this.waiting = null
      resolve({ value: undefined as never, done: true })
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    while (true) {
      if (this.pending.length > 0) {
        yield this.pending.shift()!
        continue
      }
      if (this.closed) return
      const next = await new Promise<IteratorResult<SDKUserMessage>>((resolve) => {
        this.waiting = resolve
      })
      if (next.done) return
      yield next.value
    }
  }
}

export interface SessionEvents {
  onCardChanged(card: SessionCard): void
  onTranscript(id: string, entries: TranscriptEntry[]): void
}

export interface SessionInit {
  cwd: string
  /** Absent when resuming: the session waits for your first message instead. */
  openingPrompt?: string
  /** An existing SDK session id to pick up where it left off. */
  resumeSessionId?: string
  /** Overrides the prompt-derived title, for a resumed session's own name. */
  title?: string
  /** Branch rather than continue in place, leaving the original untouched. */
  fork?: boolean
}

/** A card title has to survive being drawn somewhere narrow. */
function titleFromPrompt(prompt: string): string {
  const firstLine = prompt.trim().split('\n')[0] ?? ''
  return firstLine.length > 60 ? `${firstLine.slice(0, 57)}…` : firstLine
}

export class Session {
  readonly id = randomUUID()
  private queue = new PromptQueue()
  private stream: Query | null = null
  /** `canUseTool` parks here until a host answers. */
  private permissionResolvers = new Map<string, (result: PermissionResult) => void>()
  /**
   * What the SDK says would stop it asking again for this tool. Answering
   * "always" means handing this whole set back, so it is kept per request
   * rather than reconstructed from the tool name.
   */
  private permissionSuggestions = new Map<string, PermissionUpdate[]>()
  private transcript: TranscriptEntry[] = []
  private card: SessionCard
  private init: SessionInit
  /**
   * The last assistant text we appended. The turn's result message repeats
   * it verbatim, and appending both is what made replies look doubled.
   */
  private lastAssistantText: string | null = null

  constructor(
    init: SessionInit,
    private events: SessionEvents
  ) {
    this.init = init
    const title = init.title ?? (init.openingPrompt ? titleFromPrompt(init.openingPrompt) : '')
    this.card = {
      id: this.id,
      title: title || basename(init.cwd),
      cwd: init.cwd,
      runState: 'idle',
      activity: init.resumeSessionId
        ? init.fork
          ? 'Branched — send a message'
          : 'Resumed — send a message'
        : 'Starting…',
      summary: null,
      sessionId: init.resumeSessionId ?? null,
      pendingPermission: null,
      error: null,
      authFailed: false,
      orphaned: false,
      forkedFrom: init.fork ? (init.resumeSessionId ?? null) : null,
      updatedAt: Date.now(),
      lastMessageAt: Date.now(),
      unread: false
    }
  }

  snapshot(): SessionCard {
    return { ...this.card }
  }

  getTranscript(): TranscriptEntry[] {
    return this.transcript
  }

  private update(patch: Partial<SessionCard>): void {
    this.card = { ...this.card, ...patch, updatedAt: Date.now() }
    this.events.onCardChanged(this.snapshot())
  }

  private append(kind: TranscriptEntry['kind'], text: string): void {
    const entry: TranscriptEntry = {
      id: randomUUID(),
      kind,
      text,
      at: Date.now()
    }
    this.transcript.push(entry)
    // Rides along on the next `update()` rather than emitting its own
    // onCardChanged — every append here is immediately followed by one.
    this.card = { ...this.card, lastMessageAt: entry.at }
    this.events.onTranscript(this.id, [entry])
  }

  /** Starts the agent loop and returns immediately; the loop runs detached. */
  start(claudeExecutable?: string): void {
    const { openingPrompt, resumeSessionId } = this.init

    if (openingPrompt) {
      this.append('user', openingPrompt)
      this.queue.push(openingPrompt)
      this.update({ runState: 'running', activity: 'Starting…' })
    }

    // spawn() fails with a bare ENOENT when the working directory is gone,
    // and the SDK reports that as the *binary* being broken — a musl/glibc
    // mismatch message that has nothing to do with the real problem.
    // Catching it here means a moved or deleted project folder says so
    // plainly.
    if (!existsSync(this.init.cwd)) {
      this.failMissingCwd()
      return
    }

    const options: Options = {
      cwd: this.init.cwd,
      permissionMode: 'default',
      canUseTool: (toolName, input, opts) => this.requestPermission(toolName, input, opts),
      ...(resumeSessionId
        ? {
            resume: resumeSessionId,
            // Forking gives this card its own transcript, so the session it
            // came from keeps being driven by whatever already had it.
            ...(this.init.fork ? { forkSession: true } : {})
          }
        : {}),
      ...(claudeExecutable ? { pathToClaudeCodeExecutable: claudeExecutable } : {})
    }

    this.stream = query({ prompt: this.queue, options })
    void this.consume(this.stream)
  }

  /**
   * Replays a resumed session's history into the transcript, so opening it
   * shows the conversation being rejoined rather than an empty panel.
   */
  async loadHistory(sessionId: string): Promise<void> {
    try {
      const messages = await getSessionMessages(sessionId, { dir: this.init.cwd })
      const entries: TranscriptEntry[] = []
      for (const message of messages) {
        const text = textOf(message.message)
        if (!text) continue
        entries.push({
          id: randomUUID(),
          kind: message.type === 'user' ? 'user' : 'assistant',
          text,
          at: Date.now()
        })
      }
      if (entries.length === 0) return
      this.transcript = [...entries, ...this.transcript]
      this.lastAssistantText = [...entries].reverse().find((e) => e.kind === 'assistant')?.text ?? null
      // Nothing appended, but a host needs to know to re-read the whole
      // transcript rather than trust what it already has.
      this.events.onTranscript(this.id, [])
    } catch {
      // History is a nicety; a session that resumes without it still works.
    }
    void this.refreshSummary(sessionId)
  }

  /**
   * Claude Code keeps its own running summary of what a session is about,
   * refolded as the transcript grows — see `foldSessionSummary` in the SDK.
   * Reading it back is what lets a card say what the conversation is about
   * at a glance, without this package generating anything of its own.
   */
  private async refreshSummary(sessionId: string): Promise<void> {
    try {
      const info = await getSessionInfo(sessionId, { dir: this.init.cwd })
      const summary = info?.summary?.trim() || null
      // Not worth a second line that just repeats the title back.
      if (summary && summary !== this.card.title) this.update({ summary })
    } catch {
      // No summary yet is an ordinary state for a session that just started.
    }
  }

  private requestPermission(
    toolName: string,
    input: Record<string, unknown>,
    opts: {
      signal: AbortSignal
      toolUseID: string
      suggestions?: PermissionUpdate[]
      title?: string
      displayName?: string
      description?: string
    }
  ): Promise<PermissionResult> {
    const requestId = opts.toolUseID
    // A host usually renders a proper sentence ("Claude wants to read
    // foo.txt"). When it doesn't, "Claude wants to use Write" is useless on
    // a card, so fall back to the same phrasing the activity line uses.
    const described = describe(toolName, input)
    const pending: PendingPermission = {
      requestId,
      toolName,
      title: opts.title ?? `Claude wants to ${described.infinitive}`,
      displayName: opts.displayName ?? described.gerund,
      description: opts.description,
      // Only offer "always" when the SDK has told us what "always" would mean.
      canAlwaysAllow: (opts.suggestions?.length ?? 0) > 0
    }
    if (opts.suggestions?.length) {
      this.permissionSuggestions.set(requestId, opts.suggestions)
    }
    this.update({
      runState: 'needs_you',
      activity: pending.displayName,
      pendingPermission: pending
    })

    return new Promise<PermissionResult>((resolve) => {
      this.permissionResolvers.set(requestId, resolve)
      // An interrupt or a closed session aborts the request; deny so the
      // agent loop unblocks instead of hanging forever on a card nobody
      // will answer.
      opts.signal.addEventListener('abort', () => {
        this.permissionSuggestions.delete(requestId)
        if (this.permissionResolvers.delete(requestId)) {
          resolve({ behavior: 'deny', message: 'Cancelled.' })
        }
      })
    })
  }

  answerPermission(requestId: string, decision: 'allow' | 'allow_always' | 'deny'): void {
    const resolve = this.permissionResolvers.get(requestId)
    if (!resolve) return
    this.permissionResolvers.delete(requestId)
    const suggestions = this.permissionSuggestions.get(requestId)
    this.permissionSuggestions.delete(requestId)

    if (decision === 'deny') {
      resolve({ behavior: 'deny', message: 'Denied.' })
    } else if (decision === 'allow_always' && suggestions?.length) {
      // Handing the suggestions back is what makes "always" mean anything:
      // it is the SDK's own description of the rule that stops it asking
      // again.
      resolve({ behavior: 'allow', updatedPermissions: suggestions })
    } else {
      resolve({ behavior: 'allow' })
    }

    this.update({
      runState: 'running',
      pendingPermission: null,
      activity: 'Working…'
    })
  }

  sendPrompt(prompt: string): void {
    this.append('user', prompt)
    this.queue.push(prompt)
    this.update({ runState: 'running', activity: 'Working…' })
  }

  async interrupt(): Promise<void> {
    await this.stream?.interrupt()
    this.update({ runState: 'idle', activity: 'Interrupted' })
  }

  async close(): Promise<void> {
    this.queue.close()
    for (const [id, resolve] of this.permissionResolvers) {
      this.permissionResolvers.delete(id)
      this.permissionSuggestions.delete(id)
      resolve({ behavior: 'deny', message: 'Session closed.' })
    }
    try {
      this.stream?.close()
    } catch {
      // Already gone; nothing to clean up.
    }
  }

  setTitle(title: string): void {
    this.update({ title })
  }

  /**
   * The compression step. Most SDK message types are noise for a small
   * card; only the handful that change what the card says are read here.
   */
  private async consume(stream: Query): Promise<void> {
    try {
      for await (const message of stream) {
        this.handle(message)
      }
      if (this.card.runState === 'running') {
        this.update({ runState: 'done', activity: 'Finished' })
      }
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err)
      if (/not logged in|authenticate|credential|401|unauthor/i.test(text)) {
        this.failAuth('Claude Code could not authenticate.')
        return
      }
      this.append('error', text)
      this.update({ runState: 'error', activity: 'Failed', error: text })
    }
  }

  /** Fails the card when its project folder has been moved or deleted. */
  private failMissingCwd(): void {
    const message = `Project folder is missing: ${this.init.cwd}`
    this.append('error', message)
    this.update({
      runState: 'error',
      activity: 'Folder missing',
      error: message,
      pendingPermission: null
    })
  }

  /** Fails the card in a way a host can turn into instructions. */
  private failAuth(message: string): void {
    this.append('error', message)
    this.update({
      runState: 'error',
      activity: 'Signed out',
      error: message,
      authFailed: true,
      pendingPermission: null
    })
  }

  private handle(message: SDKMessage): void {
    switch (message.type) {
      case 'system': {
        if (message.subtype === 'init') {
          // A resumed session sits idle until you say something, so init
          // must not push it into "running" and start a spinner over
          // nothing.
          const idle = this.card.runState === 'idle'
          this.update({
            sessionId: message.session_id,
            runState: idle ? 'idle' : 'running',
            activity: idle ? this.card.activity : 'Thinking…'
          })
        } else if (message.subtype === 'status') {
          if (message.status === 'requesting') {
            this.update({ activity: 'Thinking…' })
          } else if (message.status === 'compacting') {
            this.update({ activity: 'Compacting context…' })
          }
        }
        return
      }

      case 'assistant': {
        // An auth failure arrives on the assistant frame, not as a thrown
        // error, so it would otherwise pass as an ordinary empty turn.
        if (isAuthFailure(message.error)) {
          this.failAuth(explainAuthFailure(message.error!))
          return
        }
        for (const block of message.message.content) {
          if (block.type === 'tool_use') {
            const activity = describeTool(block.name, block.input as Record<string, unknown>)
            this.update({ activity })
            this.append('tool', activity)
          } else if (block.type === 'text' && block.text.trim()) {
            this.lastAssistantText = block.text
            this.append('assistant', block.text)
            this.update({ activity: firstLine(block.text) })
          }
        }
        return
      }

      case 'result': {
        if (message.subtype === 'success') {
          if (message.is_error) {
            const text = message.result
            if (/auth|credential|401|unauthor/i.test(text)) {
              this.failAuth('Claude Code could not authenticate.')
            } else {
              this.append('error', text)
              this.update({ runState: 'error', activity: 'Failed', error: text })
            }
            return
          }
          // The result repeats the turn's final assistant text, which the
          // transcript already holds. Appending both is what made every
          // reply appear twice, so only add it when it says something new.
          if (message.result.trim() && message.result.trim() !== this.lastAssistantText?.trim()) {
            this.append('result', message.result)
          }
          this.update({
            runState: 'done',
            activity: 'Finished',
            pendingPermission: null
          })
          // Refolded after the turn that just finished, not mid-turn — the
          // SDK's own summary is written once the transcript settles.
          if (this.card.sessionId) void this.refreshSummary(this.card.sessionId)
        } else {
          this.append('error', message.subtype)
          this.update({
            runState: 'error',
            activity: 'Failed',
            error: message.subtype
          })
        }
        return
      }

      default:
        // Every other SDK message type is detail a card doesn't show.
        return
    }
  }
}

/** Pulls readable text out of a stored transcript message of unknown shape. */
function textOf(message: unknown): string | null {
  if (typeof message === 'string') return message.trim() ? unwrapSlashCommand(message.trim()) : null
  if (!message || typeof message !== 'object') return null
  const content = (message as { content?: unknown }).content
  if (typeof content === 'string') return content.trim() ? unwrapSlashCommand(content.trim()) : null
  if (!Array.isArray(content)) return null

  const text = content
    .filter(
      (block): block is { type: 'text'; text: string } =>
        typeof block === 'object' &&
        block !== null &&
        (block as { type?: string }).type === 'text' &&
        typeof (block as { text?: string }).text === 'string'
    )
    .map((block) => block.text)
    .join('\n')
    .trim()

  return text ? unwrapSlashCommand(text) : null
}

function firstLine(text: string): string {
  const line = text.trim().split('\n')[0] ?? ''
  return line.length > 70 ? `${line.slice(0, 67)}…` : line
}

export type { RunState }
