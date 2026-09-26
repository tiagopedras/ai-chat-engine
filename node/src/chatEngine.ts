import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { getSessionMessages, query, type SDKMessage, type SessionMessage } from '@anthropic-ai/claude-agent-sdk'
import type { ChatPart, ChatRunPayload, ChatSessionMeta, ChatStatus, ChatStore, ChatTurn } from './types.js'
import { unwrapSlashCommand } from './slashCommand.js'

/**
 * A host's backend for the chat window — the five-call contract
 * (plus the optional sixth, `answerPermission`) `interface/README.md`
 * documents, answered here by calling into the Agent SDK directly rather
 * than spawning a second `claude` process next to whatever `SessionPool`
 * already runs.
 *
 * A chat is deliberately not a card: it is read-only, it never goes on a
 * canvas, and it is filed under an owner key rather than sitting on its
 * own. `mode` is always `ask` for that reason — there is no config yet to
 * turn `write` or `work` on, so asking for either is refused exactly the way `engine.py`'s
 * `work` mode refuses it when a host's own config hasn't opted in.
 *
 * Ported out of `ai_canvas`'s `ChatEngine`. What changed: `resolveCwd` no
 * longer reads `SessionPool.projects()` — projects are a host concept, not
 * this package's — so a host that wants a brand-new chat's cwd resolved
 * from something like a project passes `resolveOwnerCwd` in; a resumed
 * chat never needed it; and `pairTurns` now also builds `parts`, the same
 * addition the chat window's `loadTranscript` and `engine.py`'s
 * `transcript_read` both read.
 */

const ASK_DENIES = ['Bash', 'Edit', 'Write', 'NotebookEdit', 'Task']
const MAX_REPLAY = 20 * 1024 * 1024
const MAX_TURNS = 60

export interface ChatEngineOptions {
  /** A brand new chat's cwd, when the owner key means something a host can
      resolve to a folder (a project id, say). Not called for a resumed
      chat, which already has its own cwd on file. */
  resolveOwnerCwd?: (owner: string) => string | null
  /** Where the CLI's own executable is, if a host already resolved one for
      its own SessionPool — passed straight to the SDK's `query()` so this
      doesn't spawn a second lookup. */
  executablePath?: () => string | undefined
  /** Every stream-json line a run produces, plus the synthetic
      board_start/board_error lines — a host writes each one straight onto
      its own response stream, same as `run()`'s NDJSON in
      interface/README.md. Already JSON.stringify'd. */
  onLine(runId: string, line: string): void
  /** A run has finished, one way or another. */
  onEnd(runId: string): void
}

export class ChatEngine {
  private runs = new Map<string, AbortController>()

  constructor(
    private store: ChatStore,
    private isAuthenticated: () => boolean,
    private opts: ChatEngineOptions
  ) {}

  status(): ChatStatus {
    return { available: this.isAuthenticated(), work: false, cwd: '', home: '', model: null }
  }

  sessions(): { chats: Record<string, ChatSessionMeta[]> } {
    return { chats: this.store.chats() }
  }

  /**
   * Replays a chat the same way `Session.loadHistory` replays a card,
   * paired into turns the way `engine.py`'s `transcript_read` pairs them,
   * because the modal is the same widget either way and expects the same
   * shape.
   */
  async transcript(sessionId: string, cwd: string): Promise<{ turns: ChatTurn[]; toobig: boolean }> {
    const path = transcriptFilePath(cwd, sessionId)
    let size: number
    try {
      size = (await stat(path)).size
    } catch {
      throw new Error(
        'That conversation is not on disk any more — Claude Code keeps the transcripts, and this one has been cleared.'
      )
    }
    if (size > MAX_REPLAY) return { turns: [], toobig: true }

    const messages = await getSessionMessages(sessionId, { dir: cwd })
    return { turns: pairTurns(messages).slice(-MAX_TURNS), toobig: false }
  }

  forget(owner: string, session: string): void {
    this.store.forgetChat(owner, session)
  }

  startRun(payload: ChatRunPayload): { runId: string } {
    const runId = randomUUID()
    const controller = new AbortController()
    this.runs.set(runId, controller)
    void this.execute(runId, payload, controller)
    return { runId }
  }

  stopRun(runId: string): void {
    this.runs.get(runId)?.abort()
  }

  /** A host-resolved folder for a brand new chat; a resumed one keeps the
      folder it actually started in, in case whatever it was filed under
      has since moved. */
  private resolveCwd(payload: ChatRunPayload): string | null {
    if (payload.session) {
      const row = this.store.chats()[payload.owner]?.find((r) => r.id === payload.session)
      if (row) return row.cwd
    }
    return this.opts.resolveOwnerCwd?.(payload.owner) ?? null
  }

  private async execute(runId: string, payload: ChatRunPayload, controller: AbortController): Promise<void> {
    try {
      if (payload.mode !== 'ask') {
        this.emitLine(runId, { type: 'board_error', text: `${payload.mode} mode is off` })
        return
      }
      const cwd = this.resolveCwd(payload)
      if (!cwd) {
        this.emitLine(runId, { type: 'board_error', text: 'No folder is known for that owner yet.' })
        return
      }
      this.emitLine(runId, {
        type: 'board_start',
        cwd,
        home: basename(cwd) || cwd,
        resumed: Boolean(payload.session)
      })

      let sawResult = false
      let filed = ''
      const stream = query({
        prompt: payload.prompt,
        options: {
          cwd,
          permissionMode: 'dontAsk',
          disallowedTools: ASK_DENIES,
          abortController: controller,
          ...(payload.session ? { resume: payload.session } : {}),
          ...(this.opts.executablePath?.() ? { pathToClaudeCodeExecutable: this.opts.executablePath!() } : {})
        }
      })
      for await (const message of stream as AsyncIterable<SDKMessage>) {
        if (message.type === 'result') sawResult = true
        if (payload.owner && !filed && message.type === 'system' && message.subtype === 'init') {
          filed = message.session_id
          this.store.recordChat(payload.owner, filed, payload.title, payload.mode, cwd)
        }
        this.emitLine(runId, message)
      }
      if (payload.owner && filed) this.store.touchChat(payload.owner, filed)
      if (!sawResult) {
        this.emitLine(runId, {
          type: 'board_error',
          text: controller.signal.aborted ? 'Stopped.' : 'The run ended without an answer.'
        })
      }
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err)
      this.emitLine(runId, { type: 'board_error', text })
    } finally {
      this.runs.delete(runId)
      this.emitEnd(runId)
    }
  }

  private emitLine(runId: string, line: unknown): void {
    this.opts.onLine(runId, JSON.stringify(line))
  }

  private emitEnd(runId: string): void {
    this.opts.onEnd(runId)
  }
}

/** Same slug scheme `sessionPool.ts`'s `transcriptExists` uses — kept as
    its own one-line copy here rather than shared, since a rename of one
    must not silently change what the other resolves. */
function transcriptFilePath(cwd: string, sessionId: string): string {
  return join(homedir(), '.claude', 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'), `${sessionId}.jsonl`)
}

/** A block from a stored message, typed just enough to read `text`,
    `tool_use` and `tool_result` — the three kinds a chat turn cares about. */
interface Block {
  type?: string
  text?: string
  name?: string
  input?: Record<string, unknown>
}

function blocksOf(message: unknown): Block[] {
  if (!message || typeof message !== 'object') return []
  const content = (message as { content?: unknown }).content
  if (!Array.isArray(content)) return []
  return content.filter((b): b is Block => typeof b === 'object' && b !== null)
}

/** What a user turn said, or '' for a tool result bouncing back rather than
    something a person typed — the same distinction engine.py's
    `_text_blocks` draws. */
function textSaid(message: unknown): string {
  const blocks = blocksOf(message)
  if (blocks.some((b) => b.type === 'tool_result')) return ''
  const text = blocks
    .filter((b) => b.type === 'text' && b.text)
    .map((b) => b.text)
    .join('\n\n')
    .trim()
  return text ? unwrapSlashCommand(text) : text
}

function pairTurns(messages: SessionMessage[]): ChatTurn[] {
  const turns: ChatTurn[] = []
  for (const m of messages) {
    if (m.type === 'user') {
      const said = textSaid(m.message)
      if (said) turns.push({ ask: said, reply: '', tools: [], parts: [] })
      continue
    }
    if (m.type === 'assistant' && turns.length > 0) {
      const turn = turns[turns.length - 1]
      for (const block of blocksOf(m.message)) {
        if (block.type === 'text' && block.text) {
          turn.reply += (turn.reply ? '\n\n' : '') + block.text
          // `parts` is `reply`/`tools` again, but in the order Claude
          // actually produced them — see README.md's
          // transcript() contract.
          const part: ChatPart = { type: 'text', text: block.text }
          ;(turn.parts ??= []).push(part)
        } else if (block.type === 'tool_use') {
          const name = block.name ?? ''
          const input = block.input ?? {}
          turn.tools.push({ name, input })
          const part: ChatPart = { type: 'tool', name, input }
          ;(turn.parts ??= []).push(part)
        }
      }
    }
  }
  return turns
}
