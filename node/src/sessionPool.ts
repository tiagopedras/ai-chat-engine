import { existsSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getSessionInfo, listSessions } from '@anthropic-ai/claude-agent-sdk'
import type {
  CardStore,
  CreateSessionInput,
  PastSession,
  ResumeSessionInput,
  SessionCard,
  TranscriptEntry
} from './types.js'
import { checkAuth, type AuthState } from './auth.js'
import { detectLiveSessions } from './liveness.js'
import { Session, type SessionInit } from './session.js'

/**
 * Holds every session this engine is tracking — the piece a host's own IPC
 * or HTTP layer talks to.
 *
 * Ported out of `ai_board`'s `SessionPool`, with everything that was a
 * board's business rather than a session's taken back out: no projects, no
 * geometry, no window rects, no view state, no depth ordering. `ai_board`
 * (or any other host) keeps a thin layer of its own on top of this for
 * those — see the package README's "The Node engine" section for the split.
 *
 * Three jobs beyond bookkeeping, same as the original:
 *
 * Throttling: a dozen live sessions emit events far faster than a host can
 * usefully repaint, so card changes are batched. A session that starts
 * needing you jumps that queue, because that is the whole point of a card.
 *
 * Persistence: every card is mirrored into the host's own `CardStore`, so
 * quitting is not an event.
 *
 * Parking: a card restored from a previous run does not start a process. It
 * sits there showing what it is until woken, which keeps startup instant
 * and avoids spawning a dozen agents nobody asked for.
 */

const FLUSH_MS = 120

const ORPHANED =
  'Claude Code has no transcript for this session any more, so it cannot be resumed. Start a fresh one in the same folder, or close the card.'

export interface PoolEvents {
  onCards(cards: SessionCard[]): void
  onTranscript(payload: { id: string; entries: TranscriptEntry[] }): void
  onAuth(state: AuthState): void
}

/** A restored card with no process behind it yet. */
interface ParkedCard {
  card: SessionCard
  stored: { sessionId: string; cwd: string; title: string; forkedFrom: string | null; updatedAt: number; lastMessageAt: number }
}

export class SessionPool {
  private sessions = new Map<string, Session>()
  private parked = new Map<string, ParkedCard>()
  private dirty = false
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private claudeExecutable: string | undefined
  private auth: AuthState = { status: 'unknown', detail: 'Not checked yet.' }
  /** Cards a host currently has open — see `setOpenCards`. */
  private openIds = new Set<string>()
  /** Cards that have produced output since they were last open. */
  private unreadIds = new Set<string>()

  constructor(
    private events: PoolEvents,
    private store: CardStore
  ) {
    this.claudeExecutable = resolveClaudeExecutable()
  }

  async load(): Promise<void> {
    await this.restoreParked()
    await this.refreshAuth()
  }

  /**
   * Puts every card from the store back as a `parked` card without starting
   * a single process. Waking one starts it; until then it is a label in a
   * place.
   *
   * A parked card's summary is read in the same pass, in parallel across
   * every card, rather than waiting for each to be woken — this is the one
   * moment a card not opened in weeks can still say what it was about.
   */
  private async restoreParked(): Promise<void> {
    await Promise.all(
      this.store.cards().map(async (stored) => {
        // A card whose transcript has been deleted cannot be woken. Saying
        // so at load is the difference between a card that looks fine until
        // clicked and one that says what happened.
        const orphaned = !transcriptExists(stored.cwd, stored.sessionId)
        const summary = orphaned ? null : await readSummary(stored.sessionId, stored.cwd)
        const card: SessionCard = {
          id: stored.sessionId,
          title: stored.title,
          cwd: stored.cwd,
          runState: orphaned ? 'error' : 'parked',
          activity: orphaned ? 'Transcript missing' : 'Parked — open to resume',
          summary: summary && summary !== stored.title ? summary : null,
          sessionId: stored.sessionId,
          pendingPermission: null,
          error: orphaned ? ORPHANED : null,
          authFailed: false,
          orphaned,
          forkedFrom: stored.forkedFrom,
          updatedAt: stored.updatedAt,
          lastMessageAt: stored.lastMessageAt,
          // Nothing has happened since the host last quit, so a card just
          // restored from disk has nothing new to flag.
          unread: false
        }
        this.parked.set(card.id, { card, stored })
      })
    )
  }

  /**
   * Which cards a host currently has open. A card taken off this list
   * clears its unread flag on the way out — opening it is what "read"
   * means — and a card put back on it stops collecting one, so reopening
   * the same session never flags output already being looked at.
   */
  setOpenCards(ids: string[]): void {
    this.openIds = new Set(ids)
    let changed = false
    for (const id of ids) {
      if (this.unreadIds.delete(id)) changed = true
    }
    if (changed) this.flushNow()
  }

  authState(): AuthState {
    return this.auth
  }

  /** Where the CLI was found, for anything else that spawns the SDK directly. */
  executablePath(): string | undefined {
    return this.claudeExecutable
  }

  /**
   * Re-probes the CLI's login. Called at startup, whenever a host asks, and
   * whenever a session fails in a way that looks like an auth problem — a
   * login can expire while the host is open, so this is never a
   * once-at-boot answer.
   */
  async refreshAuth(): Promise<AuthState> {
    this.auth = await checkAuth(this.claudeExecutable)
    this.events.onAuth(this.auth)
    return this.auth
  }

  /** Every card, live and parked. */
  list(): SessionCard[] {
    const cards = [
      ...[...this.sessions.values()].map((s) => s.snapshot()),
      ...[...this.parked.values()].map((p) => p.card)
    ]
    return cards.map((card) => ({ ...card, unread: this.unreadIds.has(card.id) }))
  }

  create(input: CreateSessionInput): SessionCard {
    const session = this.spawn({ cwd: input.cwd, openingPrompt: input.prompt })
    session.start(this.claudeExecutable)
    return this.cardOf(session.id) ?? session.snapshot()
  }

  /**
   * Brings a session that already exists on disk into this pool. It
   * arrives idle with its history loaded, waiting rather than picking up
   * mid-thought.
   */
  async resume(input: ResumeSessionInput): Promise<SessionCard> {
    // Never take the caller's word for it. A session that is live must be
    // branched whatever was asked, because continuing it in place is the
    // one outcome that loses work without saying so.
    const { live } = await detectLiveSessions([
      { sessionId: input.sessionId, cwd: input.cwd, lastModified: Date.now() - 1 }
    ])
    const fork = input.fork === true || live.has(input.sessionId)

    const session = this.spawn({
      cwd: input.cwd,
      resumeSessionId: input.sessionId,
      title: fork ? `${input.title} (branch)` : input.title,
      fork
    })
    await session.loadHistory(input.sessionId)
    session.start(this.claudeExecutable)
    return this.cardOf(session.id) ?? session.snapshot()
  }

  /**
   * Starts a parked card's process, keeping its place, name and filing. A
   * live card is returned as it is, so this is safe to call on anything.
   */
  async wake(id: string): Promise<SessionCard | null> {
    const existing = this.sessions.get(id)
    if (existing) return existing.snapshot()

    const parked = this.parked.get(id)
    if (!parked) return null
    // Waking a card whose transcript is gone would start a session with no
    // history and quietly pretend nothing was lost.
    if (!transcriptExists(parked.stored.cwd, parked.stored.sessionId)) {
      return parked.card
    }
    this.parked.delete(id)

    const { live } = await detectLiveSessions([
      {
        sessionId: parked.stored.sessionId,
        cwd: parked.stored.cwd,
        lastModified: parked.stored.updatedAt
      }
    ])
    const fork = live.has(parked.stored.sessionId)

    const session = this.spawn({
      cwd: parked.stored.cwd,
      resumeSessionId: parked.stored.sessionId,
      title: fork ? `${parked.stored.title} (branch)` : parked.stored.title,
      fork
    })
    // A forked wake gets a new session id, so the parked record it grew out
    // of is no longer the card this pool tracks.
    if (fork) this.store.remove(parked.stored.sessionId)
    await session.loadHistory(parked.stored.sessionId)
    session.start(this.claudeExecutable)
    this.flushNow()
    return session.snapshot()
  }

  /**
   * Sessions Claude Code has on disk, newest first, minus the ones already
   * in this pool so the list never offers a duplicate.
   */
  async pastSessions(): Promise<PastSession[]> {
    const onBoard = new Set(
      this.list()
        .map((c) => c.sessionId)
        .filter((id): id is string => Boolean(id))
    )
    try {
      const found = await listSessions({ limit: 60 })
      const usable = found
        .filter((s) => !onBoard.has(s.sessionId) && s.cwd)
        .map((s) => ({
          sessionId: s.sessionId,
          title: s.customTitle ?? s.summary ?? s.firstPrompt ?? 'Untitled',
          cwd: s.cwd!,
          lastModified: s.lastModified,
          gitBranch: s.gitBranch
        }))
      const { live } = await detectLiveSessions(usable)
      return usable.map((s) => ({ ...s, live: live.has(s.sessionId) }))
    } catch (err) {
      // Never silently: an empty list and a broken list look identical to
      // whatever draws them, and only one of them is worth investigating.
      console.error('[ai-chat-engine] listSessions failed:', err)
      return []
    }
  }

  sendPrompt(id: string, prompt: string): void {
    this.sessions.get(id)?.sendPrompt(prompt)
  }

  answerPermission(id: string, requestId: string, decision: 'allow' | 'allow_always' | 'deny'): void {
    this.sessions.get(id)?.answerPermission(requestId, decision)
  }

  async interrupt(id: string): Promise<void> {
    await this.sessions.get(id)?.interrupt()
  }

  async close(id: string): Promise<void> {
    this.unreadIds.delete(id)
    const parked = this.parked.get(id)
    if (parked) {
      this.parked.delete(id)
      this.store.remove(parked.stored.sessionId)
      this.flushNow()
      return
    }
    const session = this.sessions.get(id)
    if (!session) return
    const sessionId = session.snapshot().sessionId
    await session.close()
    this.sessions.delete(id)
    if (sessionId) this.store.remove(sessionId)
    this.flushNow()
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.sessions.values()].map((s) => s.close()))
    this.sessions.clear()
  }

  rename(id: string, title: string): void {
    const session = this.sessions.get(id)
    if (session) {
      session.setTitle(title)
      return
    }
    const parked = this.parked.get(id)
    if (!parked) return
    parked.card = { ...parked.card, title, updatedAt: Date.now() }
    this.store.patch(parked.stored.sessionId, { title })
    this.flushNow()
  }

  transcript(id: string): TranscriptEntry[] {
    return this.sessions.get(id)?.getTranscript() ?? []
  }

  private cardOf(id: string): SessionCard | undefined {
    return this.sessions.get(id)?.snapshot() ?? this.parked.get(id)?.card
  }

  private spawn(init: SessionInit): Session {
    const session = new Session(init, {
      onCardChanged: (card) => {
        this.remember(card)
        this.scheduleFlush(card)
      },
      onTranscript: (id, entries) => {
        // Output produced while nobody is looking at the card is what
        // "unread" means. A card currently open never collects one, and
        // producing more output while it already carries the flag is not a
        // second event worth another flush.
        if (entries.length > 0 && !this.openIds.has(id) && !this.unreadIds.has(id)) {
          this.unreadIds.add(id)
          this.flushNow()
        }
        this.events.onTranscript({ id, entries })
      }
    })
    this.sessions.set(session.id, session)
    return session
  }

  /**
   * Mirrors a live card into the host's CardStore. Keyed by SDK session id,
   * which only exists once the session has initialised, so cards are
   * recorded from their first init frame rather than from creation.
   */
  private remember(card: SessionCard): void {
    if (!card.sessionId) return
    // The card may have been referred to by its temporary id before it had
    // a session id — see CardStore.rekey.
    if (card.sessionId !== card.id) {
      this.store.rekey(card.id, card.sessionId)
    }
    this.store.put({
      sessionId: card.sessionId,
      cwd: card.cwd,
      title: card.title,
      forkedFrom: card.forkedFrom,
      updatedAt: card.updatedAt,
      lastMessageAt: card.lastMessageAt
    })
  }

  private scheduleFlush(card: SessionCard): void {
    // A session dying on authentication is evidence about the CLI's login,
    // not just about that one card, so let it correct a host's app-wide
    // banner.
    if (card.authFailed) void this.refreshAuth()
    // Anything that changes whether the card is asking for you goes out now.
    if (card.runState === 'needs_you' || card.runState === 'error') {
      this.flushNow()
      return
    }
    this.dirty = true
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      if (this.dirty) this.flushNow()
    }, FLUSH_MS)
  }

  private flushNow(): void {
    this.dirty = false
    this.events.onCards(this.list())
  }
}

/**
 * Electron launched from Finder does not inherit a login shell's PATH, so
 * `claude` is usually invisible to it even when it works fine in a
 * terminal. Look in the places the installers use before falling back to
 * PATH.
 */
function resolveClaudeExecutable(): string | undefined {
  const candidates = [
    process.env.CLAUDE_CODE_EXECUTABLE,
    join(homedir(), '.local/bin/claude'),
    join(homedir(), '.claude/local/claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude'
  ].filter((p): p is string => Boolean(p))

  return candidates.find((p) => existsSync(p))
}

/** Claude Code's own auto-generated summary for a session, or null if it
    has not produced one — see refreshSummary in session.ts, which reads
    the same field for a live card. */
async function readSummary(sessionId: string, cwd: string): Promise<string | null> {
  try {
    const info = await getSessionInfo(sessionId, { dir: cwd })
    return info?.summary?.trim() || null
  } catch {
    return null
  }
}

/**
 * Where Claude Code keeps a session's transcript. The directory is the
 * working directory with every non-alphanumeric character replaced by a
 * dash, which is why moving a folder orphans its history.
 *
 * Both the path as given and its resolved form are tried, because a
 * directory reached through a symlink (every `/var/folders` temporary
 * directory on macOS, for one) is recorded under whichever of the two the
 * session was started with.
 */
function transcriptExists(cwd: string, sessionId: string): boolean {
  const candidates = new Set([cwd])
  try {
    candidates.add(realpathSync(cwd))
  } catch {
    // The folder itself is gone, which the remaining candidate will report.
  }
  return [...candidates].some((path) =>
    existsSync(join(homedir(), '.claude', 'projects', path.replace(/[^a-zA-Z0-9]/g, '-'), `${sessionId}.jsonl`))
  )
}
