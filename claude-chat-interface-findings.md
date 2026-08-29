# claude.ai chat interface — full teardown

**Subject:** claude.ai chat, model set to Opus 5 (High)
**Brief given to it:** "Build a simple solar panel ROI calculator from scratch, as a single self-contained HTML file. Inputs: system cost, system size in kW, electricity price per kWh, and average sun hours per day. Outputs: estimated annual generation, annual savings, payback period in years, and 25-year net return."
**Method:** driven live in the browser; screenshot plus accessibility-tree read at every state change
**Date:** 28 August 2026
**Out of scope:** sidebar and settings, per the brief

---

## 1. What the interface is made of

Ignoring the sidebar, the whole thing is three surfaces. They are not all present at once — the screen reveals them in order as the work earns them.

### The thread (centre column)

Your messages sit in a filled rounded bubble, right-aligned. The response is unbubbled prose, left-aligned, full column width. There are no avatars, no name labels, no "You:" / "Claude:" prefixes. All speaker attribution is carried by the asymmetry — bubble vs. no bubble, right vs. left. It works, and it keeps the response reading like a document rather than like a chat log.

Response prose is set in a serif at a comfortable measure. Inline code is set in coral monospace against the dark ground (`kW × sun hours × 365`).

### The composer (anchored)

One rounded card holding every input control. It is the only persistent chrome in the interface. Contents, left to right:

| Control | Label / affordance |
|---|---|
| `+` | "Add files, connectors, and more" |
| Segmented toggle | `Chat` / `Cowork` — a radio pair |
| Model unit | `Opus 5` + `High` with a chevron — one clickable target combining model and reasoning effort |
| Mic | "Press and hold to record" |
| Waveform | "Use voice mode" |

The placeholder rotates between loads. I saw `How can I help you today?` on the first visit and `Type / for skills` on a later new chat — the interface teaching a slash-command affordance without a tooltip or a coach-mark.

### The artifact panel (right half)

Only appears once a file exists. It splits the window and comes with its own header, its own view modes, and a draggable divider labelled "Resize file viewer" in the accessibility tree.

Header contents:

- Eye / `</>` segmented toggle — **Preview** and **Code** as radio buttons
- Title: `Solar roi · HTML`
- A copy button
- `More options` — a menu with **Download** and **Share**
- `Expand` — promotes the panel to full window width
- `Go back` — dismisses the panel

---

## 2. The run, state by state

Six distinct states. The transitions are the interesting part: each one is several simultaneous changes, not a single element swapping.

### 01 — Empty

A time-aware greeting ("Hey, early bird") beside an animated starburst mark, and one composer. Nothing else. No sample prompts, no capability tour, no suggestion cards, no onboarding. The centred composer under a single line of text is the entire empty state.

### 02 — Composing

The box grows line by line rather than scrolling internally, so the whole brief stays visible while you write it.

The moment there is text in the field, the voice-mode waveform button is replaced **in the same slot** by a coral rounded-square send button with an up arrow. This is the sharpest small decision in the composer: the slot never holds both "talk to it" and "send it" at once, so the primary action is never competing with a secondary one for the same glance.

### 03 — Dispatch

Enter sends. Six things move together:

1. The greeting clears.
2. The composer slides from centre to the bottom of the window.
3. Its placeholder softens from `How can I help you today?` to `Write a message...`.
4. The `Chat`/`Cowork` toggle **disappears entirely** — mode is locked for the thread. Removed, not disabled; no lingering dead control.
5. The conversation names itself in the top bar — `Solar panel ROI calculator` — with a chevron for thread actions and a rename affordance attached directly to the title.
6. A `Share` button appears top-right, greyed out until the response finishes.

In the composer, the send arrow dims and a stop square appears beside it. Interrupting is always one click from where sending was.

### 04 — Working

No spinner. No progress bar. No percentage. Two stacked lines instead.

**Line one** — an animated starburst next to a natural-language status that rewrites itself in place as the work changes. I captured two:

> Thinking about calculating solar panel financial metrics dynamically
>
> Crafting solar-inspired visual design with irradiance aesthetics

Roughly ten seconds apart. This is a progress indicator whose *content* is the progress, which is why it reads as activity rather than as a wait.

**Line two** — a persistent receipt with its own icon:

> Loaded frontend-design skill

Worth flagging as a deliberate disclosure. The interface is telling you it picked up instructions you did not ask for, before you see anything those instructions produced.

Total run time to a finished artifact: roughly 60–90 seconds.

### 05 — Result

The live status lines collapse into a single grey summary line:

> Viewed a file, created a file, read a file

This is not obviously interactive. Hovering it fades in a chevron. Expanded, it becomes a vertical timeline with a hairline spine and per-step icons:

- 📜 scroll icon — `Loaded frontend-design skill`
- 🕐 clock — `Crafting solar-inspired visual design with irradiance aesthetics.`
- 🕐 clock — `Architected solar calculator with signature payback crossover chart and technical design language.`
- `</>` — `Building the solar ROI calculator as a singl…` (truncated with an ellipsis, does not expand further)
- 📄 document — `Presented file`

Below the trace: two short paragraphs of prose, then a file card with a `</>` thumbnail, the name `Solar roi`, the subtitle `Code · HTML`, and a `Download` button. The response closes with a static coral starburst glyph.

The prose itself did something worth noting — it volunteered the model's own limitations without being asked:

> Generation is `kW × sun hours × 365`, so it's gross output with no derate or degradation applied — the footer states that.
>
> The chart plots cumulative savings against the flat system cost, with the break-even crossing marked in amber. Currency toggle (€/£/$) is cosmetic only.

### 06 — Inspect

The artifact panel has already opened on the right, on Preview, without being asked.

`Code` switches to a dark, line-numbered, syntax-highlighted source view with its own copy control — dark regardless of the artifact's own light palette, so code reads as code and not as part of the thing being built.

`Expand` promotes the panel to full window width; the same control collapses it back.

Reloading the page restores the panel and its view mode, but the expanded tool timeline collapses again. That piece of state is not persisted.

---

## 3. Catalogue of micro-interactions

Every one of these is a state change triggered by something you did, most of them unannounced.

| Trigger | What happens |
|---|---|
| Text entered | Voice-mode waveform replaced by the coral send button, same slot |
| Text entered | Composer grows to fit rather than scrolling |
| Message sent | Thread self-titles; rename attached to the title, not buried in a menu |
| Message sent | Mode toggle removed rather than disabled |
| Message sent | Composer placeholder changes to a shorter, quieter string |
| Generating | Send dims; stop square appears; `Share` stays greyed |
| Generating | Status label rewrites itself in place; starburst animates |
| Turn ends | Trace collapses to one line; expansion chevron only appears on hover |
| Hover, your message | Reveals `Retry`, `Edit`, `Copy` |
| Hover, the response | **Nothing.** No copy, retry, or feedback controls at this window width |
| Scrolled up mid-thread | A floating "Scroll to bottom" pill appears |
| File produced | Panel opens itself on Preview; nothing asks whether you wanted it |
| Panel open | Divider draggable; `Expand` promotes to full width and back |
| Code view | Line numbers, syntax highlighting, own copy control, always dark |
| Reload | Panel and view mode restore; expanded trace does not |
| Cross-page nav | Returning to the thread reopens the panel automatically |

---

## 4. What it actually produced

300 lines, one file, no dependencies, no build step. The chart is hand-authored SVG rather than a charting library.

**Design tokens it chose for itself:** `--ink:#101820`, `--paper:#F2F3F1`, `--silicon:#2039C7` (the savings curve), `--sun:#E8A400` (break-even marker), with a monospace display face for the heading and a sans for body.

**Layout:** two columns — inputs left, chart plus a four-cell result grid right. Payback gets a "hero" cell with inverted colours and the amber value.

**The maths:**

```
generation = kW × sun hours × 365
savings    = generation × price per kWh
payback    = system cost ÷ savings
net        = (savings × 25) − system cost
```

**Defaults on load** — €9,000 system, 5 kW, €0.22/kWh, 4.5 sun hours:

| Output | Value |
|---|---|
| Annual generation | 8,213 kWh |
| Annual savings | €1,807 /yr |
| Payback period | 5.0 years |
| Net over 25 years | €36,169 |

Verified against the source: 5 × 4.5 × 365 = 8,212.5; × 0.22 = 1,806.75; 9,000 ÷ 1,806.75 = 4.98; (1,806.75 × 25) − 9,000 = 36,168.75. All four figures are correct for the model it is using.

**It disclosed its assumptions twice** — once in the chat prose, once in a footer inside the calculator itself:

> Straight-line estimate. It assumes the panels produce the same amount every year, the electricity price never moves, and there are no maintenance costs or grants. Real systems lose roughly 0.5% output a year.

**Two decisions nothing in the brief asked for:**

- Unit chips (`€`, `kW`, `€/kWh`, `h`) live in a bordered slot on the right edge of each field, so units never sit inside the input competing with the value.
- The chart marks break-even with an amber node and a drop line where the savings curve crosses the flat cost line, turning the payback number into something you can see rather than read.

**Accessibility it included unprompted:** `aria-pressed` on the currency toggles, `role="group"` with a label on the toggle set, a `<desc>` element on the SVG, `:focus-visible` outlines, and a `prefers-reduced-motion` block.

---

## 5. Friction

None of this blocked the task. Each is a place the interface stops explaining itself.

**The trace is hidden behind a hover.** `Viewed a file, created a file, read a file` reads as a status caption, not a control. The chevron that reveals the reasoning timeline only appears once the cursor is already on it — so the most interesting part of the response, what it actually did and in what order, is the part you are least likely to find.

**Number inputs mix two locales.** Fields render as `0,22` and `4,5` under a Portuguese browser locale, because `<input type="number">` follows the browser. The outputs are hardcoded to `toLocaleString("en-GB")` and come back as `€1,807`. Comma-as-decimal going in, comma-as-thousands coming out, on the same screen. Neither the brief nor the interface would have caught this.

**The currency toggle converts nothing.** Switching €/£/$ relabels every figure and changes no value. The response says so plainly, which is the right call — but a control that looks like a converter and isn't one will be misread by anyone who skipped the prose.

**No action bar on the response.** Your own message offers Retry, Edit and Copy on hover. The response offered nothing at this window width — no copy, no regenerate, no thumbs. Whether that is a narrow-viewport casualty or the current design, it reads as a gap, and the asymmetry is odd given the response is the thing you would want to copy.

**One trace entry truncates and stays truncated.** `Building the solar ROI calculator as a singl…` has no further expansion.

---

## 6. What I had to do to drive it

Types of interaction the run required, in order:

1. **Screenshot** the empty state
2. **Accessibility-tree read** to enumerate controls and get element references
3. **Click** into the composer
4. **Type** the brief
5. **Zoom** into a screen region to confirm the send button's appearance after the waveform swap
6. **Keypress** (Enter) to send
7. **Poll** — repeated wait-and-screenshot cycles through generation
8. **Hover** to reveal the trace chevron
9. **Click** the chevron to expand the trace
10. **Scroll** the thread column
11. **Click by element reference** where coordinate clicks missed (the Code toggle needed this)
12. **Page-text extraction** to pull the full 300-line source out of the Code view
13. **Window resize** attempts to fit the split view
14. **Navigate** back to the thread URL after a misclick opened a new chat
15. **JavaScript evaluation** to check viewport, device pixel ratio, and iframe geometry

Three notes on driving it specifically:

- **Coordinate clicks are unreliable at the panel header.** Clicking the `</>` icon by pixel position did nothing three times; clicking the same control by accessibility reference worked immediately.
- **The artifact preview is a sandboxed iframe that synthetic input does not reach.** Typing into the calculator's fields and clicking its currency buttons produced a brief dimming scrim and no state change. Scrolling inside it only worked after clicking into it first. Live recalculation on input had to be read from the source rather than watched. A human clicking it has no such problem.
- **The browser bridge dropped twice**, both times mid-generation, which is what cut the session short.

---

## 7. Not covered

Do not infer these from the above — they went untested:

- The follow-up turn that produces a second artifact version, and whatever version switcher comes with it
- `Edit` and `Retry` on a sent message
- `Share`
- Download (the button was present; the file was not fetched)
- The calculator operated by hand, for the sandbox reason above
