import type { ChatStatus, Endpoints, PermissionDecision, RunPayload, SessionsIndex, Transport, TranscriptTurn } from './types';

/* The HTTP shape described in the README: what a host answers if it takes the
   engine.py + http_glue.py path. */
export const DEFAULT_ENDPOINTS: Endpoints = {
  status: '/claude.json',
  sessions: '/claude/sessions.json',
  transcript: '/claude/transcript.json',
  forget: '/claude/forget',
  run: '/claude',
};

export function makeDefaultTransport(endpoints: Endpoints, guard: { name: string; value: string }): Transport {
  const guarded = (extra?: Record<string, string>) => ({ ...(extra || {}), [guard.name]: guard.value });
  const getJson = async <T>(url: string): Promise<T> => {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  };

  return {
    status: () => getJson<ChatStatus>(endpoints.status + '?t=' + Date.now()),
    sessions: () => getJson<{ chats: SessionsIndex }>(endpoints.sessions + '?t=' + Date.now()),
    transcript: (sessionId, cwd) =>
      getJson<{ turns: TranscriptTurn[]; toobig?: boolean }>(
        endpoints.transcript + '?session=' + encodeURIComponent(sessionId) + '&cwd=' + encodeURIComponent(cwd || ''),
      ),

    async *run(payload: RunPayload, signal: AbortSignal) {
      let res: Response;
      try {
        res = await fetch(endpoints.run, {
          method: 'POST',
          /* The guard header is the point, not the content type: a form
             cannot set one, so a page on another origin cannot reach the
             host's helper without a preflight the helper does not answer. */
          headers: guarded({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(payload),
          signal,
        });
      } catch {
        throw new Error(signal.aborted ? 'Stopped.' : 'Could not reach the helper — is it still running?');
      }
      if (!res.ok) {
        let msg = 'The helper refused it (HTTP ' + res.status + ')';
        try { const j = await res.json(); if (j && j.error) msg = j.error; } catch { /* not JSON */ }
        throw new Error(msg);
      }
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let buf = '';
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buf += dec.decode(chunk.value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (line) yield line;
          }
        }
      } catch (err) {
        throw new Error('The answer stopped coming: ' + ((err as Error).message || err));
      }
    },

    async forget(ownerKey, sessionId) {
      await fetch(endpoints.forget, {
        method: 'POST',
        headers: guarded({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ owner: ownerKey, session: sessionId }),
      });
    },

    /* Only present if a host wires `endpoints.permission`. A host whose
       backend never asks a per-tool question has nothing to point it at, and
       leaving it out is how that stays a no-op. */
    answerPermission: endpoints.permission
      ? async (requestId: string, decision: PermissionDecision) => {
          await fetch(endpoints.permission!, {
            method: 'POST',
            headers: guarded({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ requestId, decision }),
          });
        }
      : undefined,
  };
}
