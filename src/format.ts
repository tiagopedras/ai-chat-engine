/* The small pure functions the window's words come from: what a tool call is
   called, what to say a run is doing, what to name a conversation. */

const TOOL_FIELD: Record<string, string> = {
  Read: 'file_path', Edit: 'file_path', Write: 'file_path', Glob: 'pattern', Grep: 'pattern',
  Bash: 'command', WebFetch: 'url', WebSearch: 'query', Skill: 'skill', Task: 'description',
};

export function toolLabel(name: string, input: Record<string, unknown> | undefined, cwd: string): string {
  const inp = input || {};
  const field = TOOL_FIELD[name];
  let what = field && inp[field] ? String(inp[field]) : '';
  if (!what) {
    const first = Object.values(inp).find((v) => typeof v === 'string');
    what = (first as string) || '';
  }
  if (cwd && what.indexOf(cwd + '/') === 0) what = what.slice(cwd.length + 1);
  what = what.replace(/\s+/g, ' ').trim();
  if (what.length > 70) what = what.slice(0, 69) + '…';
  return what ? name + ' ' + what : name;
}

/* What to call what it is doing now, in words rather than in tool names.
   Rewritten in place as the run moves, which is the whole of the progress
   indicator: no bar, the content is the progress. */
const DOING: Record<string, string> = {
  starting: 'Starting up', thinking: 'Thinking it through', writing: 'Writing the answer',
  Read: 'Reading a file', Glob: 'Looking for files', Grep: 'Searching the text',
  Bash: 'Running a command', Edit: 'Editing a file', Write: 'Writing a file',
  Skill: 'Loading a skill', Task: 'Handing part of it to a subagent',
  WebFetch: 'Fetching a page', WebSearch: 'Searching the web', done: 'Finished',
};
export function runDoing(status: string): string {
  return DOING[status] || (status ? 'Using ' + status : 'Working');
}

function runCost(n: number): string {
  return n < 0.01 ? 'under 1¢' : '$' + n.toFixed(2);
}
export function runDoneLabel(run: { status: string; ms: number; started: number; cost: number }): string {
  const secs = Math.max(1, Math.round((run.ms || Date.now() - run.started) / 1000));
  const bits = [run.status === 'done' ? 'done' : 'stopped', secs + 's'];
  if (run.cost) bits.push(runCost(run.cost));
  return bits.join(' · ');
}

/* What to call a conversation, taken from the first thing said in it. The
   whole message is not a name: one sentence, cut at a word. */
export function chatTitle(ask: string): string {
  let t = String(ask).replace(/\s+/g, ' ').trim();
  const stop = /[.?!]\s/.exec(t);
  if (stop && stop.index > 12) t = t.slice(0, stop.index + 1);
  if (t.length > 54) t = t.slice(0, 54).replace(/\s+\S*$/, '') + '…';
  return t.replace(/[.,;:\s]+$/, '');
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
export function whenLabel(iso: string | undefined): string {
  const d = new Date(iso || '');
  if (isNaN(d.getTime())) return '';
  const days = Math.floor((startOfDay(new Date()) - startOfDay(d)) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return days + ' days ago';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/* Imports the session into Claude Desktop and carries it on there: the same
   conversation, the same history, in the app rather than in this window.
   `?session=` on the /code routes only accepts the desktop's own local_ ids,
   but /resume takes a CLI session id and adopts it. */
export function desktopHref(sessionId: string): string {
  return 'claude://resume?session=' + encodeURIComponent(sessionId);
}
