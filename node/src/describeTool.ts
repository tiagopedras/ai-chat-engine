import { basename } from 'node:path'

/**
 * Turns a tool call into readable English.
 *
 * Two forms come out of the same description because a card needs both: the
 * activity line reports what is happening ("Editing SCHEMA.md"), while a
 * permission prompt asks for something not yet done ("Claude wants to edit
 * SCHEMA.md"). Describing the call once and conjugating twice keeps the two
 * from drifting apart.
 *
 * Both forms favour the object over the verb's arguments. A card has room for
 * about seventy characters, and "Editing SCHEMA.md" tells you where the
 * session is, where a truncated diff does not.
 */

interface Description {
  /** Present participle, for the activity line: "Editing SCHEMA.md". */
  gerund: string
  /** Bare infinitive, for a request: "edit SCHEMA.md". */
  infinitive: string
}

/** Regular verbs, so one entry conjugates both ways. */
const VERBS: Record<string, { gerund: string; infinitive: string }> = {
  read: { gerund: 'Reading', infinitive: 'read' },
  write: { gerund: 'Writing', infinitive: 'write' },
  edit: { gerund: 'Editing', infinitive: 'edit' },
  run: { gerund: 'Running', infinitive: 'run' },
  search: { gerund: 'Searching', infinitive: 'search' },
  fetch: { gerund: 'Fetching', infinitive: 'fetch' },
  delegate: { gerund: 'Delegating', infinitive: 'delegate' },
  update: { gerund: 'Updating', infinitive: 'update' },
  use: { gerund: 'Using', infinitive: 'use' }
}

function phrase(verb: keyof typeof VERBS, object: string): Description {
  const forms = VERBS[verb]
  return {
    gerund: object ? `${forms.gerund} ${object}` : forms.gerund,
    infinitive: object ? `${forms.infinitive} ${object}` : forms.infinitive
  }
}

export function describe(
  name: string,
  input: Record<string, unknown>
): Description {
  const file = pathArg(input)

  switch (name) {
    case 'Read':
      return phrase('read', file ?? 'a file')
    case 'Write':
      return phrase('write', file ?? 'a file')
    case 'Edit':
    case 'NotebookEdit':
      return phrase('edit', file ?? 'a file')
    case 'Bash': {
      const command = str(input.command)
      return phrase('run', command ? firstWord(command) : 'a command')
    }
    case 'Glob':
    case 'Grep': {
      const pattern = str(input.pattern)
      return phrase(
        'search',
        pattern ? `for ${truncate(pattern, 40)}` : 'the project'
      )
    }
    case 'WebFetch': {
      const url = str(input.url)
      return phrase('fetch', url ? hostOf(url) : 'a page')
    }
    case 'WebSearch': {
      const q = str(input.query)
      return phrase('search', q ? `the web for ${truncate(q, 36)}` : 'the web')
    }
    case 'Task':
    case 'Agent': {
      const description = str(input.description)
      return phrase(
        'delegate',
        description ? truncate(description, 44) : 'a task'
      )
    }
    case 'TodoWrite':
      return phrase('update', 'its plan')
    case 'Skill': {
      const skill = str(input.skill)
      return phrase('run', skill ? `/${skill}` : 'a skill')
    }
    default: {
      // MCP tools arrive as mcp__server__tool; the server name is the useful half.
      const mcp = name.match(/^mcp__([^_]+)__(.+)$/)
      const label = mcp ? `${humanise(mcp[2])} (${mcp[1]})` : humanise(name)
      return phrase('use', label)
    }
  }
}

/** The activity line's form. */
export function describeTool(
  name: string,
  input: Record<string, unknown>
): string {
  return describe(name, input).gerund
}

function pathArg(input: Record<string, unknown>): string | null {
  const raw = str(input.file_path) ?? str(input.path) ?? str(input.notebook_path)
  return raw ? basename(raw) : null
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function firstWord(command: string): string {
  return truncate(command.split(/\s+/)[0] ?? command, 30)
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return truncate(url, 36)
  }
}

function humanise(name: string): string {
  return name.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2')
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}
