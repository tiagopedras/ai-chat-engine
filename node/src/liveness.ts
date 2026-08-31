import { execFile } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

/**
 * Works out whether a session is already being driven somewhere else.
 *
 * This matters because two processes on one session file is not a small
 * problem. Claude Code appends whole JSON lines and rebuilds a conversation
 * by following `parentUuid` links, so a second process writing the same
 * transcript does not corrupt the file, it forks it invisibly: two branches
 * sharing one name, only one of which gets reconstructed. Work does not
 * vanish so much as become unreachable, which is worse, because nothing
 * reports it.
 *
 * Claude Code takes no lock and does not hold the transcript open, so
 * liveness has to be inferred. Two signals, and both are needed to avoid
 * false alarms:
 *
 *   1. A running `claude` process whose working directory is the session's.
 *   2. That session being the most recently touched one for that directory.
 *
 * A very recent write counts on its own, since nothing else writes a
 * transcript. The cost of a wrong answer is asymmetric — a needless fork is
 * tidy-up, a missed one is lost work — so this errs towards calling a
 * session live.
 */

/** A transcript written this recently is being written by something. */
const DEFINITELY_ACTIVE_MS = 2 * 60 * 1000

export interface Liveness {
  /** Session ids that look like something else is driving them. */
  live: Set<string>
}

/** Claude Code stores transcripts under a slug of the working directory. */
function projectDir(cwd: string): string {
  return join(homedir(), '.claude', 'projects', cwd.replace(/[/.]/g, '-'))
}

async function transcriptAge(cwd: string, sessionId: string): Promise<number> {
  try {
    const file = join(projectDir(cwd), `${sessionId}.jsonl`)
    return Date.now() - (await stat(file)).mtimeMs
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

/** Working directories of every `claude` process currently running. */
async function busyDirectories(): Promise<Set<string>> {
  const dirs = new Set<string>()
  try {
    const { stdout } = await run('ps', ['-Ao', 'pid,comm'], { timeout: 5000 })
    const pids = stdout
      .split('\n')
      .filter((line) => /(^|\/)claude$/.test(line.trim().split(/\s+/)[1] ?? ''))
      .map((line) => line.trim().split(/\s+/)[0])
      .filter(Boolean)

    if (pids.length === 0) return dirs

    // lsof reports each process's cwd; -F n keeps the output to plain paths.
    const { stdout: open } = await run(
      'lsof',
      ['-a', '-d', 'cwd', '-p', pids.join(','), '-Fn'],
      { timeout: 8000 }
    )
    for (const line of open.split('\n')) {
      if (line.startsWith('n/')) dirs.add(line.slice(1))
    }
  } catch {
    // No process list means no evidence either way; the mtime signal stands.
  }
  return dirs
}

export async function detectLiveSessions(
  sessions: { sessionId: string; cwd: string; lastModified: number }[]
): Promise<Liveness> {
  const busy = await busyDirectories()
  const live = new Set<string>()

  // Within one directory only the newest transcript can be the live one, so
  // older sessions in a busy directory are not flagged.
  const newestPerDir = new Map<string, string>()
  for (const session of [...sessions].sort(
    (a, b) => b.lastModified - a.lastModified
  )) {
    if (!newestPerDir.has(session.cwd)) {
      newestPerDir.set(session.cwd, session.sessionId)
    }
  }

  await Promise.all(
    sessions.map(async (session) => {
      const age = await transcriptAge(session.cwd, session.sessionId)
      if (age < DEFINITELY_ACTIVE_MS) {
        live.add(session.sessionId)
        return
      }
      if (
        busy.has(session.cwd) &&
        newestPerDir.get(session.cwd) === session.sessionId
      ) {
        live.add(session.sessionId)
      }
    })
  )

  return { live }
}
