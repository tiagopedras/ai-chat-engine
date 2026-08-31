import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

/**
 * Whether the `claude` CLI a host drives is signed in.
 *
 * A host built on this package has no login of its own. It drives the Claude
 * Agent SDK, which shells out to (or embeds) the Claude Code CLI, and that
 * CLI holds its own credentials — so "are we authenticated" is a question
 * only that binary can answer. `claude auth status --json` answers it
 * without starting a session or spending anything.
 *
 * Note this is the CLI's login, not the Claude desktop app's. They are
 * separate programs with separate credential stores, so signing in to one
 * does nothing for the other. That distinction matters because it decides
 * what a host tells someone to go and do.
 */

export type AuthState =
  | {
      status: 'authenticated'
      email?: string
      subscriptionType?: string
      authMethod?: string
      orgName?: string
    }
  | { status: 'logged_out' }
  /** The binary isn't installed, or isn't where we looked. */
  | { status: 'no_cli'; detail: string }
  /** The probe itself broke; we genuinely don't know. */
  | { status: 'unknown'; detail: string }

interface AuthStatusJson {
  loggedIn?: boolean
  authMethod?: string
  email?: string
  orgName?: string
  subscriptionType?: string
}

export async function checkAuth(executable: string | undefined): Promise<AuthState> {
  if (!executable) {
    return {
      status: 'no_cli',
      detail: 'Could not find the `claude` command on this machine.'
    }
  }

  try {
    const { stdout } = await run(executable, ['auth', 'status', '--json'], {
      timeout: 15_000,
      // A login shell's PATH is not inherited when an Electron host starts
      // from Finder, and the CLI shells out to other tools, so give it a
      // usable one.
      env: { ...process.env, PATH: `${process.env.PATH ?? ''}:/usr/bin:/bin` }
    })

    const parsed = JSON.parse(stdout) as AuthStatusJson
    if (!parsed.loggedIn) return { status: 'logged_out' }

    return {
      status: 'authenticated',
      email: parsed.email,
      subscriptionType: parsed.subscriptionType,
      authMethod: parsed.authMethod,
      orgName: parsed.orgName
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    // ENOENT means the path we resolved is stale rather than that you're
    // logged out, and the two need different instructions.
    if (detail.includes('ENOENT')) {
      return { status: 'no_cli', detail }
    }
    // A non-zero exit from `auth status` is how some CLI versions report
    // "no credentials", so read it as logged out rather than as a broken probe.
    if (/not logged in|no credentials|unauthorized|401/i.test(detail)) {
      return { status: 'logged_out' }
    }
    return { status: 'unknown', detail }
  }
}

/**
 * Session errors that mean "your login stopped working" rather than "that
 * task failed". These get the same instructions as a cold start with no
 * credentials.
 */
const AUTH_FAILURES = new Set([
  'authentication_failed',
  'oauth_org_not_allowed',
  'account_on_hold',
  'billing_error'
])

export function isAuthFailure(error: string | undefined): boolean {
  return error !== undefined && AUTH_FAILURES.has(error)
}

export function explainAuthFailure(error: string): string {
  switch (error) {
    case 'authentication_failed':
      return 'Claude Code is signed out.'
    case 'oauth_org_not_allowed':
      return 'This account is not allowed to use Claude Code here.'
    case 'account_on_hold':
      return 'This Anthropic account is on hold.'
    case 'billing_error':
      return 'There is a billing problem on this Anthropic account.'
    default:
      return 'Claude Code could not authenticate.'
  }
}
