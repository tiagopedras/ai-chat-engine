/**
 * Claude Code stores a slash command as a synthetic user message wrapped in
 * `<command-name>`, `<command-message>` and `<command-args>` tags, rather
 * than the command as typed. A resumed session's history replays that
 * wrapper verbatim, so both transcript readers this package has —
 * SessionPool's session engine and ChatEngine — unwrap it back to what was
 * actually typed, e.g. "/clear", before it reaches a chat window.
 */
export function unwrapSlashCommand(text: string): string {
  const name = /<command-name>([^<]*)<\/command-name>/.exec(text)?.[1]?.trim()
  if (!name) return text
  const args = /<command-args>([^<]*)<\/command-args>/.exec(text)?.[1]?.trim()
  return args ? `${name} ${args}` : name
}
