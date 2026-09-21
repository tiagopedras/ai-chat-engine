import { useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { Alert, Button, EditableText, LinkButton, Modal, Spinner, Textarea, Window } from '@tiagopedras/tenon';
import type { ChatController, ChatView } from './controller';
import { Transcript } from './Transcript';
import { useChat, useNow } from './useChat';
import './chat.css';

/* The line above the composer. Its words are the progress: what the run is
   doing now, rewritten in place as it moves, and a clock beside it. Sits next
   to the input so it reads as "working on your last message", not as chrome
   up top. */
function Status({ view }: { view: ChatView }) {
  const running = view.status.kind === 'running';
  const now = useNow(running);
  const s = view.status;
  const spinner = (
    <Spinner
      size="sm"
      variant={view.thinkingGlyphs ? 'glyph' : 'ring'}
      className={view.thinkingGlyphs ? 'aic-star aic-glyph' : 'aic-star'}
      label="Working"
    />
  );
  if (s.kind === 'permission') {
    return <div className="aic-status aic-live" aria-live="polite">{spinner}<span className="aic-doing">Waiting on your decision</span></div>;
  }
  if (s.kind === 'running') {
    return (
      <div className="aic-status aic-live" aria-live="polite">
        {spinner}
        <span className="aic-doing">{s.doing}</span>
        <em className="aic-clock">{Math.max(0, Math.round((now - s.started) / 1000))}s</em>
      </div>
    );
  }
  return <div className="aic-status" aria-live="polite">{s.text}</div>;
}

/* The banner that takes an answer. Shown between the head and the transcript
   whenever the run is waiting on a tool decision: not a status line, which
   reports, but a question. */
function Permission({ view, controller }: { view: ChatView; controller: ChatController }) {
  const p = view.permission;
  if (!p) return null;
  return (
    <Alert
      tone="warning"
      className="aic-permission"
      title={p.title}
      actions={
        <>
          <Button variant="primary" size="sm" onClick={() => controller.answerPermission('allow')}>Allow</Button>
          {p.canAlwaysAllow && (
            <Button variant="ghost" size="sm" title="Allow this for the rest of the session, without asking again" onClick={() => controller.answerPermission('allow_always')}>
              Always allow
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => controller.answerPermission('deny')}>Deny</Button>
        </>
      }
    >
      {p.description || undefined}
    </Alert>
  );
}

function Composer({ view, controller, draft, setDraft, input }: {
  view: ChatView;
  controller: ChatController;
  draft: string;
  setDraft: (v: string) => void;
  input: React.RefObject<HTMLTextAreaElement>;
}) {
  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (controller.send(draft)) setDraft('');
    else input.current?.focus();
  };
  /* Enter sends, shift-Enter is a new line. Not while an input method is
     composing, where Enter confirms the word. */
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
  };
  return (
    <form className="aic-foot" autoComplete="off" onSubmit={submit}>
      <Textarea
        ref={input}
        autoGrow
        className="aic-input"
        placeholder={view.placeholder}
        spellCheck={false}
        value={draft}
        disabled={view.busy}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        autoFocus
      />
      {/* Send and Stop share one slot, so the primary action is never
          competing with another for the same glance. */}
      {view.busy
        ? <Button type="button" variant="secondary" className="aic-stop" onClick={controller.stop}>Stop</Button>
        : <Button type="submit" variant="primary" className="aic-send">Send</Button>}
    </form>
  );
}

/* The chat window: a Tenon Modal, or a Tenon Window when the host places it.
   What is drawn here is arrangement only. The dialog, buttons, composer, pills
   and permission banner are Tenon's, so a change to how any of them looks is
   made once, there. */
export function ChatWindow({ controller }: { controller: ChatController }) {
  const view = useChat(controller);
  const [draft, setDraft] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);

  /* A conversation opens with an empty box, or with whatever seed the host
     gave it, and never with a draft left over from the last one. */
  useEffect(() => {
    if (view.openId) setDraft(controller.takeSeed());
  }, [view.openId, controller]);

  const title = view.renamable
    ? <EditableText value={view.title} onCommit={controller.rename} />
    : view.title;
  const subtitle = (view.ownerLabel || view.subtitle) ? (
    <>
      {view.ownerLabel && <span className="aic-for">{view.ownerLabel}</span>}
      {view.subtitle && <span className="aic-sub">{view.subtitle}</span>}
    </>
  ) : undefined;
  const headEnd = view.desktopHref ? (
    <LinkButton
      variant="ghost"
      size="sm"
      className="aic-desktop"
      href={view.desktopHref}
      target="_blank"
      rel="noopener"
      title="Imports this session into Claude Desktop and carries it on there"
    >
      Open in Claude
    </LinkButton>
  ) : undefined;

  const body = (
    <>
      <Permission view={view} controller={controller} />
      <Transcript view={view} controller={controller} onEdit={(text) => { setDraft(text); input.current?.focus(); }} />
    </>
  );
  const footer = (
    <>
      <Status view={view} />
      <Composer view={view} controller={controller} draft={draft} setDraft={setDraft} input={input} />
    </>
  );

  if (view.windowed) {
    const p = view.presentation;
    return (
      <Window
        open={view.open}
        onClose={controller.closeChat}
        title={title}
        subtitle={subtitle}
        headEnd={headEnd}
        footer={footer}
        bare
        className="aic-box"
        data-state={view.runState || undefined}
        rect={p.rect}
        growFrom={p.growFrom}
        zIndex={p.zIndex}
        active={p.active}
        peeked={p.peeked}
        onRectLive={controller.rectLive}
        onRectChange={controller.rectChange}
        onFocus={controller.pressed}
      >
        {body}
      </Window>
    );
  }
  return (
    <Modal
      open={view.open}
      onClose={controller.closeChat}
      title={title}
      subtitle={subtitle}
      headEnd={headEnd}
      footer={footer}
      size="lg"
      bare
      className="aic-box aic-modal"
    >
      {body}
    </Modal>
  );
}
