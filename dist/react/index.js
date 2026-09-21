import { useEffect as e, useLayoutEffect as t, useRef as n, useState as r, useSyncExternalStore as i } from "react";
import { Alert as a, Button as o, Disclosure as s, EditableText as c, LinkButton as l, Markdown as u, Modal as d, Pill as f, Spinner as p, Textarea as m, Window as h } from "@tiagopedras/tenon";
import { Fragment as g, jsx as _, jsxs as v } from "react/jsx-runtime";
import { createRoot as y } from "react-dom/client";
//#region src/Transcript.tsx
function b({ text: t, className: i }) {
	let [a, s] = r("idle"), c = n();
	e(() => () => clearTimeout(c.current), []);
	let l = (e) => {
		s(e), clearTimeout(c.current), c.current = setTimeout(() => s("idle"), e === "done" ? 1500 : 4e3);
	};
	return /* @__PURE__ */ _(o, {
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
function x({ tools: e }) {
	if (!e.length) return null;
	let t = [];
	e.forEach((e) => {
		let n = e.split(" ")[0];
		t.includes(n) || t.push(n);
	});
	let n = `${e.length} ${e.length === 1 ? "step" : "steps"} · ${t.slice(0, 4).join(", ")}${t.length > 4 ? "…" : ""}`;
	return /* @__PURE__ */ _(s, {
		className: "aic-trace",
		summary: n,
		children: /* @__PURE__ */ _("ol", {
			className: "aic-timeline",
			children: e.map((e, t) => /* @__PURE__ */ v("li", { children: [/* @__PURE__ */ _("span", { className: "aic-tick" }), e] }, t))
		})
	});
}
function S({ flow: e }) {
	let t = [], n = [], r = (e) => {
		n.length && (t.push(/* @__PURE__ */ _("div", {
			className: "aic-toolpills",
			children: n.map((e, t) => /* @__PURE__ */ _(f, {
				dot: !0,
				children: e
			}, t))
		}, `p${e}`)), n = []);
	};
	return e.forEach((e, i) => {
		e.kind === "tool" ? n.push(e.label) : (r(i), t.push(/* @__PURE__ */ _(u, {
			className: "aic-reply",
			children: e.text
		}, `t${i}`)));
	}), r(e.length), e.length ? /* @__PURE__ */ _("div", {
		className: "aic-flow",
		children: t
	}) : null;
}
function C({ turn: e, index: t, showActs: n, inlineTools: r, onRetry: i, onEdit: s }) {
	return /* @__PURE__ */ v("div", {
		className: "aic-turn",
		children: [
			/* @__PURE__ */ _("div", {
				className: "aic-mine",
				children: /* @__PURE__ */ v("div", {
					className: "aic-minewrap",
					children: [/* @__PURE__ */ _("div", {
						className: "aic-bubble",
						children: /* @__PURE__ */ _(u, {
							inline: !0,
							children: e.ask
						})
					}), n && /* @__PURE__ */ v("div", {
						className: "aic-mineacts",
						children: [
							/* @__PURE__ */ _(b, { text: e.ask }),
							/* @__PURE__ */ _(o, {
								size: "sm",
								variant: "secondary",
								onClick: () => i(t),
								children: "Retry"
							}),
							/* @__PURE__ */ _(o, {
								size: "sm",
								variant: "secondary",
								onClick: () => s(t),
								children: "Edit"
							})
						]
					})]
				})
			}),
			r ? /* @__PURE__ */ _(S, { flow: e.flow }) : /* @__PURE__ */ _(x, { tools: e.tools }),
			e.reply && (r ? /* @__PURE__ */ _("div", {
				className: "aic-acts",
				children: /* @__PURE__ */ _(b, { text: e.reply })
			}) : /* @__PURE__ */ v("div", {
				className: "aic-reply",
				children: [/* @__PURE__ */ _(u, { children: e.reply }), /* @__PURE__ */ _("div", {
					className: "aic-acts",
					children: /* @__PURE__ */ _(b, { text: e.reply })
				})]
			})),
			e.error && /* @__PURE__ */ _(a, {
				tone: "error",
				className: "aic-err",
				title: e.error,
				children: e.detail || void 0
			})
		]
	});
}
var w = (e) => e.scrollHeight - e.scrollTop - e.clientHeight < 80;
function T({ view: e, controller: i, onEdit: s }) {
	let c = n(null), l = n(!0), [u, d] = r(!1), f = n(!1), p = () => {
		let e = c.current;
		e && (l.current = w(e), d(!l.current && e.scrollHeight > e.clientHeight));
	};
	t(() => {
		let t = c.current;
		t && ((e.busy || f.current) && l.current && (t.scrollTop = t.scrollHeight), f.current = e.busy, p());
	});
	let m;
	return m = e.loadErr && !e.turns.length ? /* @__PURE__ */ _(a, {
		tone: "error",
		children: e.loadErr
	}) : e.toobig ? /* @__PURE__ */ _("p", {
		className: "aic-none",
		children: "That transcript is too large to replay here. Claude Desktop will open it in full."
	}) : e.turns.length ? e.turns.map((t, n) => /* @__PURE__ */ _(C, {
		turn: t,
		index: n,
		showActs: n === e.turns.length - 1 && !e.busy,
		inlineTools: e.inlineTools,
		onRetry: i.retry,
		onEdit: (e) => s(i.editText(e))
	}, n)) : e.loading ? /* @__PURE__ */ _("p", {
		className: "aic-none",
		children: "…"
	}) : /* @__PURE__ */ v("p", {
		className: "aic-none",
		children: [
			"Nothing said yet. What it can see is everything under ",
			/* @__PURE__ */ _("code", { children: e.home }),
			"."
		]
	}), /* @__PURE__ */ v("div", {
		className: "aic-bodywrap",
		children: [/* @__PURE__ */ _("div", {
			className: "aic-body",
			ref: c,
			onScroll: p,
			children: m
		}), u && /* @__PURE__ */ _(o, {
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
function E(e) {
	return i(e.subscribe, e.getSnapshot, e.getSnapshot);
}
function D(t) {
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
function O({ view: e }) {
	let t = D(e.status.kind === "running"), n = e.status, r = /* @__PURE__ */ _(p, {
		size: "sm",
		variant: e.thinkingGlyphs ? "glyph" : "ring",
		className: e.thinkingGlyphs ? "aic-star aic-glyph" : "aic-star",
		label: "Working"
	});
	return n.kind === "permission" ? /* @__PURE__ */ v("div", {
		className: "aic-status aic-live",
		"aria-live": "polite",
		children: [r, /* @__PURE__ */ _("span", {
			className: "aic-doing",
			children: "Waiting on your decision"
		})]
	}) : n.kind === "running" ? /* @__PURE__ */ v("div", {
		className: "aic-status aic-live",
		"aria-live": "polite",
		children: [
			r,
			/* @__PURE__ */ _("span", {
				className: "aic-doing",
				children: n.doing
			}),
			/* @__PURE__ */ v("em", {
				className: "aic-clock",
				children: [Math.max(0, Math.round((t - n.started) / 1e3)), "s"]
			})
		]
	}) : /* @__PURE__ */ _("div", {
		className: "aic-status",
		"aria-live": "polite",
		children: n.text
	});
}
function k({ view: e, controller: t }) {
	let n = e.permission;
	return n ? /* @__PURE__ */ _(a, {
		tone: "warning",
		className: "aic-permission",
		title: n.title,
		actions: /* @__PURE__ */ v(g, { children: [
			/* @__PURE__ */ _(o, {
				variant: "primary",
				size: "sm",
				onClick: () => t.answerPermission("allow"),
				children: "Allow"
			}),
			n.canAlwaysAllow && /* @__PURE__ */ _(o, {
				variant: "ghost",
				size: "sm",
				title: "Allow this for the rest of the session, without asking again",
				onClick: () => t.answerPermission("allow_always"),
				children: "Always allow"
			}),
			/* @__PURE__ */ _(o, {
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
	return /* @__PURE__ */ v("form", {
		className: "aic-foot",
		autoComplete: "off",
		onSubmit: a,
		children: [/* @__PURE__ */ _(m, {
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
		}), e.busy ? /* @__PURE__ */ _(o, {
			type: "button",
			variant: "secondary",
			className: "aic-stop",
			onClick: t.stop,
			children: "Stop"
		}) : /* @__PURE__ */ _(o, {
			type: "submit",
			variant: "primary",
			className: "aic-send",
			children: "Send"
		})]
	});
}
function j({ controller: t }) {
	let i = E(t), [a, o] = r(""), s = n(null);
	e(() => {
		i.openId && o(t.takeSeed());
	}, [i.openId, t]);
	let u = i.renamable ? /* @__PURE__ */ _(c, {
		value: i.title,
		onCommit: t.rename
	}) : i.title, f = i.ownerLabel || i.subtitle ? /* @__PURE__ */ v(g, { children: [i.ownerLabel && /* @__PURE__ */ _("span", {
		className: "aic-for",
		children: i.ownerLabel
	}), i.subtitle && /* @__PURE__ */ _("span", {
		className: "aic-sub",
		children: i.subtitle
	})] }) : void 0, p = i.desktopHref ? /* @__PURE__ */ _(l, {
		variant: "ghost",
		size: "sm",
		className: "aic-desktop",
		href: i.desktopHref,
		target: "_blank",
		rel: "noopener",
		title: "Imports this session into Claude Desktop and carries it on there",
		children: "Open in Claude"
	}) : void 0, m = /* @__PURE__ */ v(g, { children: [/* @__PURE__ */ _(k, {
		view: i,
		controller: t
	}), /* @__PURE__ */ _(T, {
		view: i,
		controller: t,
		onEdit: (e) => {
			o(e), s.current?.focus();
		}
	})] }), y = /* @__PURE__ */ v(g, { children: [/* @__PURE__ */ _(O, { view: i }), /* @__PURE__ */ _(A, {
		view: i,
		controller: t,
		draft: a,
		setDraft: o,
		input: s
	})] });
	if (i.windowed) {
		let e = i.presentation;
		return /* @__PURE__ */ _(h, {
			open: i.open,
			onClose: t.closeChat,
			title: u,
			subtitle: f,
			headEnd: p,
			footer: y,
			bare: !0,
			className: "aic-box",
			"data-state": i.runState || void 0,
			rect: e.rect,
			growFrom: e.growFrom,
			zIndex: e.zIndex,
			active: e.active,
			peeked: e.peeked,
			onRectLive: t.rectLive,
			onRectChange: t.rectChange,
			onFocus: t.pressed,
			children: m
		});
	}
	return /* @__PURE__ */ _(d, {
		open: i.open,
		onClose: t.closeChat,
		title: u,
		subtitle: f,
		headEnd: p,
		footer: y,
		size: "lg",
		bare: !0,
		className: "aic-box aic-modal",
		children: m
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
function I(e) {
	return e < .01 ? "under 1¢" : "$" + e.toFixed(2);
}
function L(e) {
	let t = Math.max(1, Math.round((e.ms || Date.now() - e.started) / 1e3)), n = [e.status === "done" ? "done" : "stopped", t + "s"];
	return e.cost && n.push(I(e.cost)), n.join(" · ");
}
function R(e) {
	let t = String(e).replace(/\s+/g, " ").trim(), n = /[.?!]\s/.exec(t);
	return n && n.index > 12 && (t = t.slice(0, n.index + 1)), t.length > 54 && (t = t.slice(0, 54).replace(/\s+\S*$/, "") + "…"), t.replace(/[.,;:\s]+$/, "");
}
function z(e) {
	return new Date(e.getFullYear(), e.getMonth(), e.getDate()).getTime();
}
function B(e) {
	let t = new Date(e || "");
	if (isNaN(t.getTime())) return "";
	let n = Math.floor((z(/* @__PURE__ */ new Date()) - z(t)) / 864e5);
	return n <= 0 ? "today" : n === 1 ? "yesterday" : n < 7 ? n + " days ago" : t.toLocaleDateString(void 0, {
		day: "numeric",
		month: "short",
		year: "numeric"
	});
}
function V(e) {
	return "claude://resume?session=" + encodeURIComponent(e);
}
//#endregion
//#region src/transport.ts
var H = {
	status: "/claude.json",
	sessions: "/claude/sessions.json",
	transcript: "/claude/transcript.json",
	forget: "/claude/forget",
	run: "/claude"
};
function U(e, t) {
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
//#region src/controller.ts
var W = class {
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
	listeners = /* @__PURE__ */ new Set();
	snap = null;
	constructor(e = {}) {
		this.opts = e;
		let t = {
			...H,
			...e.endpoints || {}
		}, n = {
			name: "X-Board",
			value: "1",
			...e.guardHeader || {}
		};
		this.transport = Object.assign(U(t, n), e.transport || {}), this.windowed = !!e.windowed, this.defaultMode = e.mode === "work" ? "work" : "ask";
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
			if (!(this.windowed && this.growOrigin && !(typeof matchMedia == "function" && matchMedia("(prefers-reduced-motion: reduce)").matches))) {
				this.finishClose();
				return;
			}
			this.closing = !0, this.emit(), this.closeTimer = setTimeout(() => this.finishClose(), 280);
		}
	};
	finishClose() {
		this.closeTimer &&= (clearTimeout(this.closeTimer), null), this.current = null, this.closing = !1, this.emit(), this.opts.onChange?.();
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
		return t.preface &&= null, this.opts.onSend?.({
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
			title: (this.sessionsFor(t.key).find((e) => e.id === t.session) || {}).title || R(n),
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
			title: (this.sessionsFor(t.key).find((e) => e.id === t.session) || {}).title || R(n.ask),
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
		this.closeTimer &&= (clearTimeout(this.closeTimer), null), this.current = null, this.closing = !1, this.listeners.clear();
	};
	build() {
		let e = this.current, t = this.currentRun(), n = e ? this.sessionsFor(e.key).find((t) => t.id === e.session) : void 0, r = n && n.title || t && t.title || "New chat", i = !!(t && t.running), a;
		return a = e ? t && t.permission ? { kind: "permission" } : t && t.running ? {
			kind: "running",
			doing: F(t.status),
			started: t.started
		} : t ? {
			kind: "text",
			text: (t.mode === "work" ? "Claude, working in " : "Claude, reading in ") + (t.home || "") + " · " + L(t)
		} : e.loading ? {
			kind: "text",
			text: "Reading the transcript…"
		} : e.session ? {
			kind: "text",
			text: "Earlier conversation · " + (n && B(n.updated) || "")
		} : {
			kind: "text",
			text: "New conversation in " + this.home() + " · " + (e.mode === "work" ? "can write" : "reads only")
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
			desktopHref: this.opts.desktopLink !== !1 && e && e.session ? V(e.session) : null,
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
			presentation: {
				rect: this.rect,
				growFrom: this.growOrigin,
				zIndex: this.zIndex,
				active: this.active,
				peeked: this.peeked
			}
		};
	}
};
//#endregion
//#region src/create.tsx
function G(e = {}) {
	let t = new W(e), n = null, r = null, i = () => {
		r || (n = document.createElement("div"), n.setAttribute("data-ai-chat", ""), document.body.appendChild(n), r = y(n), r.render(/* @__PURE__ */ _(j, { controller: t })));
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
		destroy() {
			t.destroy(), r?.unmount(), n?.remove(), r = null, n = null;
		}
	};
}
//#endregion
export { W as ChatController, j as ChatWindow, H as DEFAULT_ENDPOINTS, R as chatTitle, G as create, V as desktopHref, U as makeDefaultTransport, N as toolLabel, E as useChat, B as whenLabel };
