import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Alert, Button, Disclosure, Markdown, Pill } from '@tiagopedras/tenon';
import type { ChatController, ChatView } from './controller';
import type { Turn } from './types';

/* A Copy button that says what happened, then goes back to saying Copy. */
function CopyButton({ text, className }: { text: string; className?: string }) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);
  const flash = (next: 'done' | 'failed') => {
    setState(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), next === 'done' ? 1500 : 4000);
  };
  return (
    <Button
      size="sm"
      variant="secondary"
      className={className}
      data-state={state === 'idle' ? undefined : state}
      onClick={() => {
        (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => flash('done'), () => flash('failed'));
      }}
    >
      {state === 'done' ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy'}
    </Button>
  );
}

/* What it did, in order. One quiet summary line that opens into a timeline. */
function Trace({ tools }: { tools: string[] }) {
  if (!tools.length) return null;
  const kinds: string[] = [];
  tools.forEach((t) => { const verb = t.split(' ')[0]; if (!kinds.includes(verb)) kinds.push(verb); });
  const summary = `${tools.length} ${tools.length === 1 ? 'step' : 'steps'} · ${kinds.slice(0, 4).join(', ')}${kinds.length > 4 ? '…' : ''}`;
  return (
    <Disclosure className="aic-trace" summary={summary}>
      <ol className="aic-timeline">
        {tools.map((t, i) => <li key={i}><span className="aic-tick" />{t}</li>)}
      </ol>
    </Disclosure>
  );
}

/* The whole turn in the order it happened: text as prose, and tool calls
   grouped into a row of pills wherever they fall, not gathered into one block
   before or after the text. */
function Flow({ flow }: { flow: Turn['flow'] }) {
  const out: ReactNode[] = [];
  let pills: string[] = [];
  const flush = (i: number) => {
    if (!pills.length) return;
    out.push(<div key={`p${i}`} className="aic-toolpills">{pills.map((l, j) => <Pill key={j} dot>{l}</Pill>)}</div>);
    pills = [];
  };
  flow.forEach((seg, i) => {
    if (seg.kind === 'tool') pills.push(seg.label);
    else { flush(i); out.push(<Markdown key={`t${i}`} className="aic-reply">{seg.text}</Markdown>); }
  });
  flush(flow.length);
  return flow.length ? <div className="aic-flow">{out}</div> : null;
}

interface TurnProps {
  turn: Turn;
  index: number;
  /** Retry and Edit, and only ever on the last turn once the run has stopped. */
  showActs: boolean;
  inlineTools: boolean;
  onRetry: (i: number) => void;
  onEdit: (i: number) => void;
}

/* Who said what is carried by the shape, not by a label: yours is a filled
   bubble pushed right, the reply is unbubbled prose running the full width.
   No avatars, no "you:" prefix. */
function TurnView({ turn, index, showActs, inlineTools, onRetry, onEdit }: TurnProps) {
  return (
    <div className="aic-turn">
      <div className="aic-mine">
        <div className="aic-minewrap">
          <div className="aic-bubble"><Markdown inline>{turn.ask}</Markdown></div>
          {showActs && (
            <div className="aic-mineacts">
              <CopyButton text={turn.ask} />
              <Button size="sm" variant="secondary" onClick={() => onRetry(index)}>Retry</Button>
              <Button size="sm" variant="secondary" onClick={() => onEdit(index)}>Edit</Button>
            </div>
          )}
        </div>
      </div>
      {inlineTools ? <Flow flow={turn.flow} /> : <Trace tools={turn.tools} />}
      {turn.reply && (inlineTools ? (
        <div className="aic-acts"><CopyButton text={turn.reply} /></div>
      ) : (
        <div className="aic-reply">
          <Markdown>{turn.reply}</Markdown>
          <div className="aic-acts"><CopyButton text={turn.reply} /></div>
        </div>
      ))}
      {turn.error && <Alert tone="error" className="aic-err" title={turn.error}>{turn.detail || undefined}</Alert>}
    </div>
  );
}

const nearBottom = (el: HTMLElement) => el.scrollHeight - el.scrollTop - el.clientHeight < 80;

interface Props {
  view: ChatView;
  controller: ChatController;
  onEdit: (text: string) => void;
}

export function Transcript({ view, controller, onEdit }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  /* Whether the reader was already at the bottom before this content landed.
     It decides whether new content pulls the view down with it or leaves it
     where it was and offers the pill. Kept from the last scroll rather than
     measured now, because by now the content has grown. */
  const stick = useRef(true);
  const [pill, setPill] = useState(false);
  const wasBusy = useRef(false);

  const measure = () => {
    const el = scroller.current;
    if (!el) return;
    stick.current = nearBottom(el);
    setPill(!stick.current && el.scrollHeight > el.clientHeight);
  };

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    /* One more pull down when the run ends: the Retry and Edit row appears
       then, and would otherwise leave the last line cut off. */
    if ((view.busy || wasBusy.current) && stick.current) el.scrollTop = el.scrollHeight;
    wasBusy.current = view.busy;
    measure();
  });

  let body: ReactNode;
  if (view.loadErr && !view.turns.length) body = <Alert tone="error">{view.loadErr}</Alert>;
  else if (view.toobig) body = <p className="aic-none">That transcript is too large to replay here. Claude Desktop will open it in full.</p>;
  else if (!view.turns.length) {
    body = view.loading
      ? <p className="aic-none">…</p>
      : <p className="aic-none">Nothing said yet. What it can see is everything under <code>{view.home}</code>.</p>;
  } else {
    body = view.turns.map((t, i) => (
      <TurnView
        key={i}
        turn={t}
        index={i}
        showActs={i === view.turns.length - 1 && !view.busy}
        inlineTools={view.inlineTools}
        onRetry={controller.retry}
        onEdit={(n) => onEdit(controller.editText(n))}
      />
    ));
  }

  return (
    <div className="aic-bodywrap">
      <div className="aic-body" ref={scroller} onScroll={measure}>{body}</div>
      {pill && (
        <Button
          size="sm"
          variant="secondary"
          className="aic-scrollpill"
          onClick={() => { const el = scroller.current; if (el) { el.scrollTop = el.scrollHeight; measure(); } }}
        >
          New messages ↓
        </Button>
      )}
    </div>
  );
}
