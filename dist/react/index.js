import { useEffect as e, useLayoutEffect as t, useRef as n, useState as r, useSyncExternalStore as i } from "react";
import { Alert as a, Button as o, Disclosure as s, EditableText as c, LinkButton as l, Markdown as u, Modal as d, Pill as f, Spinner as p, Switch as m, Textarea as h, Window as g } from "@tiagopedras/tenon";
import { Fragment as _, jsx as v, jsxs as y } from "react/jsx-runtime";
import { createRoot as b } from "react-dom/client";
//#region src/Transcript.tsx
function x({ text: t, className: i }) {
	let [a, s] = r("idle"), c = n();
	e(() => () => clearTimeout(c.current), []);
	let l = (e) => {
		s(e), clearTimeout(c.current), c.current = setTimeout(() => s("idle"), e === "done" ? 1500 : 4e3);
	};
	return /* @__PURE__ */ v(o, {
		size: "sm",
		variant: "secondary",
		className: i,
		"data-state": a === "idle" ? void 0 : a,
		onClick: () => {
			(navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => l("done"), () => l("failed"));
		},
		children: a === "done" ? "Copied" : a === "failed" ? "Copy failed" : "Copy"
	});
}
function S({ tools: e }) {
	if (!e.length) return null;
	let t = [];
	e.forEach((e) => {
		let n = e.split(" ")[0];
		t.includes(n) || t.push(n);
	});
	let n = `${e.length} ${e.length === 1 ? "step" : "steps"} · ${t.slice(0, 4).join(", ")}${t.length > 4 ? "…" : ""}`;
	return /* @__PURE__ */ v(s, {
		className: "aic-trace",
		summary: n,
		children: /* @__PURE__ */ v("ol", {
			className: "aic-timeline",
			children: e.map((e, t) => /* @__PURE__ */ y("li", { children: [/* @__PURE__ */ v("span", { className: "aic-tick" }), e] }, t))
		})
	});
}
function C({ flow: e }) {
	let t = [], n = [], r = (e) => {
		n.length && (t.push(/* @__PURE__ */ v("div", {
			className: "aic-toolpills",
			children: n.map((e, t) => /* @__PURE__ */ v(f, {
				dot: !0,
				children: e
			}, t))
		}, `p${e}`)), n = []);
	};
	return e.forEach((e, i) => {
		e.kind === "tool" ? n.push(e.label) : (r(i), t.push(/* @__PURE__ */ v(u, {
			className: "aic-reply",
			children: e.text
		}, `t${i}`)));
	}), r(e.length), e.length ? /* @__PURE__ */ v("div", {
		className: "aic-flow",
		children: t
	}) : null;
}
function w({ turn: e, index: t, showActs: n, inlineTools: r, onRetry: i, onEdit: s }) {
	return /* @__PURE__ */ y("div", {
		className: "aic-turn",
		children: [
			/* @__PURE__ */ v("div", {
				className: "aic-mine",
				children: /* @__PURE__ */ y("div", {
					className: "aic-minewrap",
					children: [/* @__PURE__ */ v("div", {
						className: "aic-bubble",
						children: /* @__PURE__ */ v(u, {
							inline: !0,
							children: e.ask
						})
					}), n && /* @__PURE__ */ y("div", {
						className: "aic-mineacts",
						children: [
							/* @__PURE__ */ v(x, { text: e.ask }),
							/* @__PURE__ */ v(o, {
								size: "sm",
								variant: "secondary",
								onClick: () => i(t),
								children: "Retry"
							}),
							/* @__PURE__ */ v(o, {
								size: "sm",
								variant: "secondary",
								onClick: () => s(t),
								children: "Edit"
							})
						]
					})]
				})
			}),
			r ? /* @__PURE__ */ v(C, { flow: e.flow }) : /* @__PURE__ */ v(S, { tools: e.tools }),
			e.reply && (r ? /* @__PURE__ */ v("div", {
				className: "aic-acts",
				children: /* @__PURE__ */ v(x, { text: e.reply })
			}) : /* @__PURE__ */ y("div", {
				className: "aic-reply",
				children: [/* @__PURE__ */ v(u, { children: e.reply }), /* @__PURE__ */ v("div", {
					className: "aic-acts",
					children: /* @__PURE__ */ v(x, { text: e.reply })
				})]
			})),
			e.error && /* @__PURE__ */ v(a, {
				tone: "error",
				className: "aic-err",
				title: e.error,
				children: e.detail || void 0
			})
		]
	});
}
var T = (e) => e.scrollHeight - e.scrollTop - e.clientHeight < 80;
function E({ view: e, controller: i, onEdit: s }) {
	let c = n(null), l = n(!0), [u, d] = r(!1), f = n(!1), p = () => {
		let e = c.current;
		e && (l.current = T(e), d(!l.current && e.scrollHeight > e.clientHeight));
	};
	t(() => {
		let t = c.current;
		t && ((e.busy || f.current) && l.current && (t.scrollTop = t.scrollHeight), f.current = e.busy, p());
	});
	let m;
	return m = e.loadErr && !e.turns.length ? /* @__PURE__ */ v(a, {
		tone: "error",
		children: e.loadErr
	}) : e.toobig ? /* @__PURE__ */ v("p", {
		className: "aic-none",
		children: "That transcript is too large to replay here. Claude Desktop will open it in full."
	}) : e.turns.length ? e.turns.map((t, n) => /* @__PURE__ */ v(w, {
		turn: t,
		index: n,
		showActs: n === e.turns.length - 1 && !e.busy,
		inlineTools: e.inlineTools,
		onRetry: i.retry,
		onEdit: (e) => s(i.editText(e))
	}, n)) : e.loading ? /* @__PURE__ */ v("p", {
		className: "aic-none",
		children: "…"
	}) : /* @__PURE__ */ y("p", {
		className: "aic-none",
		children: [
			"Nothing said yet. What it can see is everything under ",
			/* @__PURE__ */ v("code", { children: e.home }),
			"."
		]
	}), /* @__PURE__ */ y("div", {
		className: "aic-bodywrap",
		children: [/* @__PURE__ */ v("div", {
			className: "aic-body",
			ref: c,
			onScroll: p,
			children: m
		}), u && /* @__PURE__ */ v(o, {
			size: "sm",
			variant: "secondary",
			className: "aic-scrollpill",
			onClick: () => {
				let e = c.current;
				e && (e.scrollTop = e.scrollHeight, p());
			},
			children: "New messages ↓"
		})]
	});
}
//#endregion
//#region src/useChat.ts
function D(e) {
	return i(e.subscribe, e.getSnapshot, e.getSnapshot);
}
function O(t) {
	let [n, i] = r(() => Date.now());
	return e(() => {
		if (!t) return;
		i(Date.now());
		let e = setInterval(() => i(Date.now()), 1e3);
		return () => clearInterval(e);
	}, [t]), n;
}
//#endregion
//#region src/ChatWindow.tsx
function ee({ view: e }) {
	let t = O(e.status.kind === "running"), n = e.status, r = /* @__PURE__ */ v(p, {
		size: "sm",
		variant: e.thinkingGlyphs ? "glyph" : "ring",
		className: e.thinkingGlyphs ? "aic-star aic-glyph" : "aic-star",
		label: "Working"
	});
	return n.kind === "permission" ? /* @__PURE__ */ y("div", {
		className: "aic-status aic-live",
		"aria-live": "polite",
		children: [r, /* @__PURE__ */ v("span", {
			className: "aic-doing",
			children: "Waiting on your decision"
		})]
	}) : n.kind === "running" ? /* @__PURE__ */ y("div", {
		className: "aic-status aic-live",
		"aria-live": "polite",
		children: [
			r,
			/* @__PURE__ */ v("span", {
				className: "aic-doing",
				children: n.doing
			}),
			/* @__PURE__ */ y("em", {
				className: "aic-clock",
				children: [Math.max(0, Math.round((t - n.started) / 1e3)), "s"]
			})
		]
	}) : /* @__PURE__ */ v("div", {
		className: "aic-status",
		"aria-live": "polite",
		children: n.text
	});
}
function k({ view: e, controller: t }) {
	let n = e.permission;
	return n ? /* @__PURE__ */ v(a, {
		tone: "warning",
		className: "aic-permission",
		title: n.title,
		actions: /* @__PURE__ */ y(_, { children: [
			/* @__PURE__ */ v(o, {
				variant: "primary",
				size: "sm",
				onClick: () => t.answerPermission("allow"),
				children: "Allow"
			}),
			n.canAlwaysAllow && /* @__PURE__ */ v(o, {
				variant: "ghost",
				size: "sm",
				title: "Allow this for the rest of the session, without asking again",
				onClick: () => t.answerPermission("allow_always"),
				children: "Always allow"
			}),
			/* @__PURE__ */ v(o, {
				variant: "ghost",
				size: "sm",
				onClick: () => t.answerPermission("deny"),
				children: "Deny"
			})
		] }),
		children: n.description || void 0
	}) : null;
}
function A({ view: e, controller: t, draft: n, setDraft: r, input: i }) {
	let a = (e) => {
		e?.preventDefault(), t.send(n) ? r("") : i.current?.focus();
	};
	return /* @__PURE__ */ y("form", {
		className: "aic-foot",
		autoComplete: "off",
		onSubmit: a,
		children: [/* @__PURE__ */ v(h, {
			ref: i,
			autoGrow: !0,
			className: "aic-input",
			placeholder: e.placeholder,
			spellCheck: !1,
			value: n,
			disabled: e.busy,
			onChange: (e) => r(e.target.value),
			onKeyDown: (e) => {
				e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && (e.preventDefault(), a());
			},
			autoFocus: !0
		}), e.busy ? /* @__PURE__ */ v(o, {
			type: "button",
			variant: "secondary",
			className: "aic-stop",
			onClick: t.stop,
			children: "Stop"
		}) : /* @__PURE__ */ v(o, {
			type: "submit",
			variant: "primary",
			className: "aic-send",
			children: "Send"
		})]
	});
}
function j({ controller: t }) {
	let i = D(t), [a, s] = r(""), u = n(null);
	e(() => {
		i.openId && s(t.takeSeed());
	}, [i.openId, t]);
	let f = i.renamable ? /* @__PURE__ */ v(c, {
		value: i.title,
		onCommit: t.rename
	}) : i.title, p = i.ownerLabel || i.subtitle ? /* @__PURE__ */ y(_, { children: [i.ownerLabel && /* @__PURE__ */ v("span", {
		className: "aic-for",
		children: i.ownerLabel
	}), i.subtitle && /* @__PURE__ */ v("span", {
		className: "aic-sub",
		children: i.subtitle
	})] }) : void 0, h = i.writeSwitch ? /* @__PURE__ */ y("label", {
		className: "aic-write",
		title: "Lets Claude create and edit files inside its working folder, from your next message",
		children: [/* @__PURE__ */ v(m, {
			checked: i.canWrite,
			onChange: t.setWrite,
			"aria-label": "Can write"
		}), /* @__PURE__ */ v("span", { children: "Can write" })]
	}) : null, b = i.desktopHref ? /* @__PURE__ */ v(l, {
		variant: "ghost",
		size: "sm",
		className: "aic-desktop",
		href: i.desktopHref,
		target: "_blank",
		rel: "noopener",
		title: "Imports this session into Claude Desktop and carries it on there",
		children: "Open in Claude"
	}) : null, x = h || b ? /* @__PURE__ */ y(_, { children: [h, b] }) : void 0, S = /* @__PURE__ */ y(_, { children: [/* @__PURE__ */ v(k, {
		view: i,
		controller: t
	}), /* @__PURE__ */ v(E, {
		view: i,
		controller: t,
		onEdit: (e) => {
			s(e), u.current?.focus();
		}
	})] }), C = /* @__PURE__ */ y(_, { children: [/* @__PURE__ */ v(ee, { view: i }), /* @__PURE__ */ v(A, {
		view: i,
		controller: t,
		draft: a,
		setDraft: s,
		input: u
	})] }), w = i.presentation;
	if (i.dockable && w.dock !== "none") {
		let e = w.dock === "minimised", n = (e) => {
			t.pressed();
			let n = e.target;
			n.closest(".tenon-window__head") && !n.closest("button,a,input,textarea,[contenteditable=\"true\"]") && e.stopPropagation();
		}, r = i.status.kind === "permission" ? "Needs you" : i.status.kind === "running" ? i.status.doing : i.runState || "", a = e ? /* @__PURE__ */ v("span", {
			className: "aic-dockstate",
			children: r
		}) : /* @__PURE__ */ y(_, { children: [
			x,
			/* @__PURE__ */ v(o, {
				variant: "ghost",
				size: "sm",
				iconOnly: !0,
				className: "aic-minimise",
				"aria-label": "Minimise",
				title: "Minimise",
				onClick: t.minimise,
				children: "–"
			}),
			/* @__PURE__ */ v(o, {
				variant: "ghost",
				size: "sm",
				iconOnly: !0,
				className: "aic-expand",
				"aria-label": "Expand",
				title: "Expand",
				onClick: t.expand,
				children: "⤢"
			})
		] });
		return /* @__PURE__ */ v(g, {
			open: i.open,
			onClose: t.closeChat,
			closeButton: !i.pinned,
			title: e ? i.title : f,
			subtitle: e ? void 0 : p,
			headEnd: a,
			footer: e ? void 0 : C,
			bare: !0,
			className: "aic-box aic-docked " + (e ? "aic-minimised" : "aic-anchored") + (i.pinned ? " aic-pinned" : ""),
			"data-state": i.runState || void 0,
			rect: w.dockRect,
			zIndex: w.zIndex,
			active: w.active && !e,
			onPointerDownCapture: n,
			onClick: e ? (e) => {
				e.target.closest("button,a") || t.anchor();
			} : void 0,
			children: e ? null : S
		});
	}
	let T = i.dockable ? /* @__PURE__ */ y(_, { children: [x, /* @__PURE__ */ v(o, {
		variant: "ghost",
		size: "sm",
		iconOnly: !0,
		className: "aic-minimise",
		"aria-label": "Minimise",
		title: "Minimise",
		onClick: t.minimise,
		children: "–"
	})] }) : x;
	return i.windowed ? /* @__PURE__ */ v(g, {
		open: i.open,
		onClose: t.closeChat,
		title: f,
		subtitle: p,
		headEnd: T,
		footer: C,
		bare: !0,
		className: "aic-box",
		"data-state": i.runState || void 0,
		rect: w.rect,
		growFrom: w.growFrom,
		zIndex: w.zIndex,
		active: w.active,
		peeked: w.peeked,
		onRectLive: t.rectLive,
		onRectChange: t.rectChange,
		onFocus: t.pressed,
		children: S
	}) : /* @__PURE__ */ v(d, {
		open: i.open,
		onClose: t.closeChat,
		title: f,
		subtitle: p,
		headEnd: T,
		footer: C,
		size: "lg",
		bare: !0,
		className: "aic-box aic-modal",
		children: S
	});
}
//#endregion
//#region src/format.ts
var M = {
	Read: "file_path",
	Edit: "file_path",
	Write: "file_path",
	Glob: "pattern",
	Grep: "pattern",
	Bash: "command",
	WebFetch: "url",
	WebSearch: "query",
	Skill: "skill",
	Task: "description"
};
function N(e, t, n) {
	let r = t || {}, i = M[e], a = i && r[i] ? String(r[i]) : "";
	return a ||= Object.values(r).find((e) => typeof e == "string") || "", n && a.indexOf(n + "/") === 0 && (a = a.slice(n.length + 1)), a = a.replace(/\s+/g, " ").trim(), a.length > 70 && (a = a.slice(0, 69) + "…"), a ? e + " " + a : e;
}
var P = {
	starting: "Starting up",
	thinking: "Thinking it through",
	writing: "Writing the answer",
	Read: "Reading a file",
	Glob: "Looking for files",
	Grep: "Searching the text",
	Bash: "Running a command",
	Edit: "Editing a file",
	Write: "Writing a file",
	Skill: "Loading a skill",
	Task: "Handing part of it to a subagent",
	WebFetch: "Fetching a page",
	WebSearch: "Searching the web",
	done: "Finished"
};
function F(e) {
	return P[e] || (e ? "Using " + e : "Working");
}
function te(e) {
	return e < .01 ? "under 1¢" : "$" + e.toFixed(2);
}
function ne(e) {
	let t = Math.max(1, Math.round((e.ms || Date.now() - e.started) / 1e3)), n = [e.status === "done" ? "done" : "stopped", t + "s"];
	return e.cost && n.push(te(e.cost)), n.join(" · ");
}
function I(e) {
	let t = String(e).replace(/\s+/g, " ").trim(), n = /[.?!]\s/.exec(t);
	return n && n.index > 12 && (t = t.slice(0, n.index + 1)), t.length > 54 && (t = t.slice(0, 54).replace(/\s+\S*$/, "") + "…"), t.replace(/[.,;:\s]+$/, "");
}
function L(e) {
	return new Date(e.getFullYear(), e.getMonth(), e.getDate()).getTime();
}
function R(e) {
	let t = new Date(e || "");
	if (isNaN(t.getTime())) return "";
	let n = Math.floor((L(/* @__PURE__ */ new Date()) - L(t)) / 864e5);
	return n <= 0 ? "today" : n === 1 ? "yesterday" : n < 7 ? n + " days ago" : t.toLocaleDateString(void 0, {
		day: "numeric",
		month: "short",
		year: "numeric"
	});
}
function z(e) {
	return "claude://resume?session=" + encodeURIComponent(e);
}
//#endregion
//#region src/transport.ts
var B = {
	status: "/claude.json",
	sessions: "/claude/sessions.json",
	transcript: "/claude/transcript.json",
	forget: "/claude/forget",
	run: "/claude"
};
function V(e, t) {
	let n = (e) => ({
		...e || {},
		[t.name]: t.value
	}), r = async (e) => {
		let t = await fetch(e, { cache: "no-store" });
		if (!t.ok) throw Error("HTTP " + t.status);
		return t.json();
	};
	return {
		status: () => r(e.status + "?t=" + Date.now()),
		sessions: () => r(e.sessions + "?t=" + Date.now()),
		transcript: (t, n) => r(e.transcript + "?session=" + encodeURIComponent(t) + "&cwd=" + encodeURIComponent(n || "")),
		async *run(t, r) {
			let i;
			try {
				i = await fetch(e.run, {
					method: "POST",
					headers: n({ "Content-Type": "application/json" }),
					body: JSON.stringify(t),
					signal: r
				});
			} catch {
				throw Error(r.aborted ? "Stopped." : "Could not reach the helper — is it still running?");
			}
			if (!i.ok) {
				let e = "The helper refused it (HTTP " + i.status + ")";
				try {
					let t = await i.json();
					t && t.error && (e = t.error);
				} catch {}
				throw Error(e);
			}
			let a = i.body.getReader(), o = new TextDecoder(), s = "";
			try {
				for (;;) {
					let e = await a.read();
					if (e.done) break;
					s += o.decode(e.value, { stream: !0 });
					let t;
					for (; (t = s.indexOf("\n")) >= 0;) {
						let e = s.slice(0, t).trim();
						s = s.slice(t + 1), e && (yield e);
					}
				}
			} catch (e) {
				throw Error("The answer stopped coming: " + (e.message || e));
			}
		},
		async forget(t, r) {
			await fetch(e.forget, {
				method: "POST",
				headers: n({ "Content-Type": "application/json" }),
				body: JSON.stringify({
					owner: t,
					session: r
				})
			});
		},
		answerPermission: e.permission ? async (t, r) => {
			await fetch(e.permission, {
				method: "POST",
				headers: n({ "Content-Type": "application/json" }),
				body: JSON.stringify({
					requestId: t,
					decision: r
				})
			});
		} : void 0
	};
}
//#endregion
//#region src/dock.ts
var H = 16, U = 12, W = 300, G = 52, K = 400, q = 560, J = [], Y = /* @__PURE__ */ new Set(), X = !1;
function Z() {
	Y.forEach((e) => e());
}
var re = Z;
function ie(e) {
	return Y.add(e), () => {
		Y.delete(e);
	};
}
function ae(e) {
	J.includes(e) || J.push(e), !X && typeof window < "u" && (X = !0, window.addEventListener("resize", Z)), Z();
}
function Q(e) {
	let t = J.indexOf(e);
	t < 0 || (J.splice(t, 1), Z());
}
function oe() {
	return [...J.filter((e) => e.pinned?.()), ...J.filter((e) => !e.pinned?.())];
}
function se(e) {
	let t = oe(), n = t.indexOf(e);
	if (n < 0) return null;
	let r = typeof window < "u" ? window.innerWidth : 1280, i = typeof window < "u" ? window.innerHeight : 800, a = r - H;
	for (let e = 0; e < n; e++) a -= (t[e].dockState() === "anchored" ? K : W) + U;
	let o = e.dockState() === "anchored", s = o ? K : W, c = o ? Math.min(q, i - 32) : G;
	return {
		x: a - s,
		y: i - c,
		width: s,
		height: c
	};
}
//#endregion
//#region src/controller.ts
function ce(e) {
	return e ? "(Writing is now switched on for this conversation: you can create and edit files inside the working directory, and nothing outside it. Anything said earlier about not being able to write no longer holds.)" : "(Writing is now switched off again for this conversation: you can read, but not create or edit files.)";
}
var $ = class {
	opts;
	transport;
	windowed;
	defaultMode;
	claudeStatus = null;
	chatsIndex = {};
	runs = {};
	runCounter = 0;
	current = null;
	header = null;
	closing = !1;
	closeTimer = null;
	openId = 0;
	originRect = null;
	growOrigin = null;
	rect = null;
	zIndex;
	active = !0;
	peeked = !1;
	dockable;
	pin;
	dock = "none";
	unDock = null;
	listeners = /* @__PURE__ */ new Set();
	snap = null;
	constructor(e = {}) {
		this.opts = e;
		let t = {
			...B,
			...e.endpoints || {}
		}, n = {
			name: "X-Board",
			value: "1",
			...e.guardHeader || {}
		};
		this.transport = Object.assign(V(t, n), e.transport || {}), this.windowed = !!e.windowed, this.defaultMode = e.mode === "work" || e.mode === "write" ? e.mode : "ask", this.dockable = !!e.dockable, this.pin = this.dockable && !!e.pinned, this.dockable && (this.unDock = ie(() => {
			this.dock !== "none" && this.emit();
		}));
	}
	subscribe = (e) => (this.listeners.add(e), () => {
		this.listeners.delete(e);
	});
	getSnapshot = () => this.snap ??= this.build();
	emit() {
		this.snap = null, this.listeners.forEach((e) => e());
	}
	available = () => !!this.claudeStatus && !(this.opts.isLocked?.() ?? !1);
	status = () => this.claudeStatus;
	home = () => this.claudeStatus ? String(this.claudeStatus.home ?? "") : "";
	isOpen = () => !!this.current;
	sessionsFor = (e) => (e && this.chatsIndex[e] || []).slice().sort((e, t) => String(t.updated || "").localeCompare(String(e.updated || "")));
	newOwnerKey = () => {
		let e = "";
		do
			e = Math.random().toString(36).slice(2, 8);
		while (e.length < 6 || this.chatsIndex[e]);
		return e;
	};
	runFor(e) {
		if (!e) return null;
		let t = Object.values(this.runs).filter((t) => t.session === e);
		return t.length ? t[t.length - 1] : null;
	}
	currentRun() {
		let e = this.current;
		return e ? e.run || this.runFor(e.session) : null;
	}
	currentTurns() {
		let e = this.current;
		if (!e) return [];
		let t = this.currentRun();
		return t ? t.turns : e.turns || [];
	}
	loadStatus = async () => {
		try {
			let e = await this.transport.status();
			this.claudeStatus = e && e.available ? e : null, this.opts.onStatusChanged?.(this.claudeStatus), this.claudeStatus && this.loadSessions();
		} catch {}
	};
	loadSessions = async () => {
		try {
			let e = await this.transport.sessions();
			this.chatsIndex = e && e.chats || {}, this.opts.onSessionsChanged?.(this.chatsIndex), this.current && this.emit(), this.opts.onChange?.();
		} catch {}
	};
	forget = async (e, t) => {
		try {
			await this.transport.forget(e, t);
		} catch {}
		await this.loadSessions();
	};
	openInternal(e, t, n, r, i) {
		this.closeTimer &&= (clearTimeout(this.closeTimer), null), this.closing = !1, this.current = {
			owner: e,
			key: t,
			session: n || "",
			seed: r || "",
			mode: this.defaultMode,
			modeNote: "",
			preface: typeof i == "function" ? i : null,
			turns: null,
			loading: !1,
			run: this.runFor(n)
		}, this.openId++, this.growOrigin = this.windowed ? this.originRect : null, this.originRect = null, this.emit(), n && !this.runFor(n) && this.loadTranscript(n);
	}
	openNew = (e, t, n, r) => this.openInternal(e, t, "", n || "", r?.preface);
	openSession = (e, t, n) => this.openInternal(e, t, n, "");
	closeChat = () => {
		if (this.current && !this.closing) {
			if (this.pin) {
				this.minimise();
				return;
			}
			if (!(this.windowed && this.growOrigin && !(typeof matchMedia == "function" && matchMedia("(prefers-reduced-motion: reduce)").matches))) {
				this.finishClose();
				return;
			}
			this.closing = !0, this.emit(), this.closeTimer = setTimeout(() => this.finishClose(), 280);
		}
	};
	finishClose() {
		this.closeTimer &&= (clearTimeout(this.closeTimer), null), this.leaveDock(), this.current = null, this.closing = !1, this.emit(), this.opts.onChange?.();
	}
	async loadTranscript(e) {
		let t = this.current;
		if (!t) return;
		t.loading = !0, this.emit();
		let n = this.sessionsFor(t.key).find((t) => t.id === e), r = n && n.cwd || "";
		try {
			let t = await this.transport.transcript(e, r);
			if (!this.current || this.current.session !== e) return;
			this.current.turns = t.toobig ? [] : t.turns.map((e) => {
				let t = (e.tools || []).map((e) => N(e.name, e.input, r)), n = Array.isArray(e.parts) && e.parts.length ? e.parts.map((e) => e.type === "tool" ? {
					kind: "tool",
					label: N(e.name, e.input, r)
				} : {
					kind: "text",
					text: e.text || ""
				}) : [...t.map((e) => ({
					kind: "tool",
					label: e
				})), ...e.reply ? [{
					kind: "text",
					text: e.reply
				}] : []];
				return {
					ask: e.ask,
					reply: e.reply || "",
					error: "",
					detail: "",
					cost: 0,
					tools: t,
					flow: n
				};
			}), this.current.toobig = !!t.toobig;
		} catch {
			this.current && (this.current.loadErr = "That conversation is not on disk any more — Claude Code keeps the transcripts, and this one has been cleared.");
		}
		this.current && (this.current.loading = !1, this.emit());
	}
	handleRunEvent(e, t, n) {
		let r;
		try {
			r = JSON.parse(n);
		} catch {
			return;
		}
		if (e.permission && r.type !== "board_permission" && (e.permission = null), r.type === "board_permission") {
			e.permission = {
				requestId: r.requestId || "",
				toolName: r.toolName || "",
				title: r.title || "Claude wants permission",
				description: r.description || "",
				canAlwaysAllow: !!r.canAlwaysAllow
			}, e.status = "needs_you";
			return;
		}
		if (r.type === "board_start") {
			e.cwd = r.cwd || "", e.home = r.home || "", e.status = "thinking";
			return;
		}
		if (r.type === "board_error") {
			t.error = r.text || "the run failed", r.detail && (t.detail = r.detail);
			return;
		}
		if (r.type === "system" && r.subtype === "init") {
			r.session_id && r.session_id !== e.session && (e.session = r.session_id, this.current && this.current.owner === e.owner && !this.current.session && (this.current.session = r.session_id), this.loadSessions());
			return;
		}
		if (r.type === "assistant" && r.message) {
			for (let n of r.message.content || []) if (n.type === "text" && n.text) {
				let i = (r.message.id || "") + "|" + n.text;
				if (e.seen[i]) continue;
				e.seen[i] = 1, t.reply += (t.reply ? "\n\n" : "") + n.text, t.flow.push({
					kind: "text",
					text: n.text
				}), e.status = "writing";
			} else if (n.type === "thinking") e.status = "thinking";
			else if (n.type === "tool_use") {
				let r = N(n.name, n.input, e.cwd);
				t.tools.push(r), t.flow.push({
					kind: "tool",
					label: r
				}), e.status = n.name;
			}
			return;
		}
		r.type === "result" && (typeof r.result == "string" && r.result.trim() && (t.reply = r.result, t.flow.some((e) => e.kind === "text") || t.flow.push({
			kind: "text",
			text: r.result
		})), r.session_id && (e.session = r.session_id), typeof r.total_cost_usd == "number" && (t.cost = r.total_cost_usd, e.cost += r.total_cost_usd), r.is_error && !t.error && (t.error = "ended in an error (" + (r.subtype || "unknown") + ")"), e.ms = r.duration_ms || Date.now() - e.started, e.status = "done");
	}
	finishRun(e) {
		e.running = !1, e.ctrl = null, e.status !== "done" && (e.status = "stopped"), this.emit(), this.loadSessions(), this.opts.onChange?.();
	}
	async startRun(e) {
		let t = this.runs["n" + ++this.runCounter] = {
			owner: e.owner,
			key: e.key,
			session: e.session || "",
			title: e.title || e.ask,
			mode: e.mode || "ask",
			running: !0,
			status: "starting",
			cwd: "",
			home: this.home(),
			permission: null,
			turns: e.turns.slice(),
			started: Date.now(),
			ms: 0,
			cost: 0,
			seen: {},
			ctrl: new AbortController()
		}, n = {
			ask: e.ask,
			reply: "",
			tools: [],
			flow: [],
			error: "",
			detail: "",
			cost: 0
		};
		t.turns.push(n), this.current && this.current.owner === t.owner && (this.current.run = t), this.emit();
		try {
			for await (let r of this.transport.run({
				prompt: e.prompt || e.ask,
				mode: t.mode,
				session: t.session,
				owner: t.key,
				title: t.title
			}, t.ctrl.signal)) this.handleRunEvent(t, n, r), this.emit();
		} catch (e) {
			t.ctrl && t.ctrl.signal.aborted ? n.reply || (n.error = "Stopped.") : n.error = e?.message || String(e);
		}
		this.finishRun(t);
	}
	send = (e) => {
		let t = this.current;
		if (!t) return !1;
		let n = e.trim();
		if (!n) return !1;
		let r = this.currentRun();
		if (r && r.running) return !1;
		let i = t.preface && !t.session ? t.preface(n) : n;
		return t.preface &&= null, t.modeNote &&= (t.session && (i = t.modeNote + "\n\n" + i), ""), this.opts.onSend?.({
			owner: t.owner,
			key: t.key,
			session: t.session || "",
			ask: n,
			prompt: i,
			mode: t.mode || "ask"
		}), this.startRun({
			owner: t.owner,
			key: t.key,
			session: t.session,
			ask: n,
			prompt: i,
			title: (this.sessionsFor(t.key).find((e) => e.id === t.session) || {}).title || I(n),
			mode: t.mode || "ask",
			turns: r ? r.turns : t.turns || []
		}), !0;
	};
	stop = () => {
		let e = this.currentRun();
		e && e.ctrl && e.ctrl.abort();
	};
	retry = (e) => {
		let t = this.current;
		if (!t) return;
		let n = this.currentTurns()[e], r = this.currentRun();
		!n || r && r.running || this.startRun({
			owner: t.owner,
			key: t.key,
			session: t.session,
			ask: n.ask,
			title: (this.sessionsFor(t.key).find((e) => e.id === t.session) || {}).title || I(n.ask),
			mode: t.mode || "ask",
			turns: r ? r.turns : t.turns || []
		});
	};
	editText = (e) => this.currentTurns()[e]?.ask ?? "";
	takeSeed = () => {
		let e = this.current;
		if (!e || !e.seed) return "";
		let t = e.seed;
		return e.seed = "", this.currentTurns().length ? "" : t;
	};
	answerPermission = (e) => {
		let t = this.currentRun();
		if (!t || !t.permission) return;
		let n = t.permission.requestId;
		t.permission = null, this.emit(), this.transport.answerPermission && Promise.resolve(this.transport.answerPermission(n, e)).catch(() => {});
	};
	writeAllowed = () => !!this.opts.writeSwitch && !!this.claudeStatus?.work;
	setWrite = (e) => {
		let t = this.current;
		if (!t || !this.writeAllowed()) return;
		let n = e ? "write" : this.defaultMode === "write" ? "ask" : this.defaultMode;
		t.mode !== n && (t.mode = n, t.modeNote = t.modeNote ? "" : (this.opts.writeNote || ce)(e), this.emit());
	};
	setHeader = (e) => {
		this.header = e || null, this.emit();
	};
	rename = (e) => this.opts.onRename?.(e);
	growFrom = (e) => {
		if (!e) {
			this.originRect = null;
			return;
		}
		let t = e;
		this.originRect = {
			left: t.left ?? t.x,
			top: t.top ?? t.y,
			width: t.width,
			height: t.height
		};
	};
	setRect = (e) => {
		this.windowed && e && (this.rect = {
			x: e.x,
			y: e.y,
			width: e.width,
			height: e.height
		}, this.emit());
	};
	setZIndex = (e) => {
		this.zIndex = e, this.emit();
	};
	setActive = (e) => {
		this.active = !!e, this.emit();
	};
	setPeeked = (e) => {
		this.peeked = !!e, this.emit();
	};
	dockState = () => this.dock;
	pinned = () => this.pin;
	running = () => Object.values(this.runs).some((e) => e.running);
	setDock(e) {
		if (!this.dockable || !this.current || this.dock === e) return;
		let t = this.dock;
		this.dock = e, e === "none" ? (Q(this), this.emit()) : t === "none" ? ae(this) : re();
	}
	leaveDock() {
		this.dock !== "none" && (this.dock = "none", Q(this));
	}
	minimise = () => this.setDock("minimised");
	anchor = () => this.setDock("anchored");
	expand = () => this.setDock("none");
	rectLive = (e) => this.opts.onRectLive?.(e);
	rectChange = (e) => {
		this.rect = e, this.opts.onRectChange?.(e);
	};
	pressed = () => this.opts.onFocus?.();
	destroy = () => {
		for (let e of Object.keys(this.runs)) {
			let t = this.runs[e];
			if (t && t.ctrl) try {
				t.ctrl.abort();
			} catch {}
			delete this.runs[e];
		}
		this.closeTimer &&= (clearTimeout(this.closeTimer), null), this.leaveDock(), this.unDock?.(), this.unDock = null, this.current = null, this.closing = !1, this.listeners.clear();
	};
	build() {
		let e = this.current, t = this.currentRun(), n = e ? this.sessionsFor(e.key).find((t) => t.id === e.session) : void 0, r = n && n.title || t && t.title || "New chat", i = !!(t && t.running), a;
		return a = e ? t && t.permission ? { kind: "permission" } : t && t.running ? {
			kind: "running",
			doing: F(t.status),
			started: t.started
		} : t ? {
			kind: "text",
			text: (t.mode === "work" ? "Claude, working in " : t.mode === "write" ? "Claude, writing in " : "Claude, reading in ") + (t.home || "") + " · " + ne(t)
		} : e.loading ? {
			kind: "text",
			text: "Reading the transcript…"
		} : e.session ? {
			kind: "text",
			text: "Earlier conversation · " + (n && R(n.updated) || "")
		} : {
			kind: "text",
			text: "New conversation in " + this.home() + " · " + (e.mode === "work" ? "can write" : e.mode === "write" ? "can write inside it" : "reads only")
		} : {
			kind: "text",
			text: ""
		}, {
			open: !!e && !this.closing,
			openId: this.openId,
			windowed: this.windowed,
			owner: e?.owner ?? "",
			session: e?.session ?? "",
			title: this.header && this.header.title || r,
			ownerLabel: e && this.opts.ownerLabel?.(e.owner) || "",
			subtitle: this.header && this.header.subtitle || "",
			runState: this.header && this.header.runState || "",
			desktopHref: this.opts.desktopLink !== !1 && e && e.session ? z(e.session) : null,
			status: a,
			turns: this.currentTurns().map((e) => ({
				...e,
				tools: e.tools.slice(),
				flow: e.flow.slice()
			})),
			busy: i,
			loading: !!e?.loading,
			loadErr: e?.loadErr ?? "",
			toobig: !!e?.toobig,
			home: this.home(),
			permission: t && t.permission ? { ...t.permission } : null,
			placeholder: this.opts.placeholder || "Ask Claude…",
			inlineTools: !!this.opts.inlineTools,
			thinkingGlyphs: !!this.opts.thinkingGlyphs,
			renamable: typeof this.opts.onRename == "function",
			dockable: this.dockable,
			pinned: this.pin,
			writeSwitch: !!e && this.writeAllowed(),
			canWrite: !!e && e.mode === "write",
			presentation: {
				rect: this.rect,
				growFrom: this.growOrigin,
				zIndex: this.zIndex,
				active: this.active,
				peeked: this.peeked,
				dock: this.dock,
				dockRect: this.dock === "none" ? null : se(this)
			}
		};
	}
};
//#endregion
//#region src/create.tsx
function le(e = {}) {
	let t = new $(e), n = null, r = null, i = () => {
		r || (n = document.createElement("div"), n.setAttribute("data-ai-chat", ""), document.body.appendChild(n), r = b(n), r.render(/* @__PURE__ */ v(j, { controller: t })));
	};
	return {
		loadStatus: t.loadStatus,
		loadSessions: t.loadSessions,
		available: t.available,
		status: t.status,
		home: t.home,
		sessionsFor: t.sessionsFor,
		newOwnerKey: t.newOwnerKey,
		forget: t.forget,
		isOpen: t.isOpen,
		closeChat: t.closeChat,
		openNew(e, n, r, a) {
			i(), t.openNew(e, n, r, a);
		},
		openSession(e, n, r) {
			i(), t.openSession(e, n, r);
		},
		growFrom: t.growFrom,
		setRect: t.setRect,
		setZIndex: t.setZIndex,
		setActive: t.setActive,
		setPeeked: t.setPeeked,
		setHeader: t.setHeader,
		minimise: t.minimise,
		anchor: t.anchor,
		expand: t.expand,
		dockState: t.dockState,
		setWrite: t.setWrite,
		canWrite: () => t.getSnapshot().canWrite,
		running: t.running,
		session: () => t.getSnapshot().session,
		destroy() {
			t.destroy(), r?.unmount(), n?.remove(), r = null, n = null;
		}
	};
}
//#endregion
export { $ as ChatController, j as ChatWindow, B as DEFAULT_ENDPOINTS, I as chatTitle, le as create, z as desktopHref, V as makeDefaultTransport, N as toolLabel, D as useChat, R as whenLabel };
