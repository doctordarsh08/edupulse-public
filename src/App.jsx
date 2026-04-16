import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import * as XLSX from "xlsx";
import Papa from "papaparse";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell,
} from "recharts";

// ─── API — key is injected automatically by the Claude.ai artifact platform ──
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const apiHeaders = () => ({
  "Content-Type": "application/json",
  "anthropic-version": "2023-06-01",
  "anthropic-dangerous-direct-browser-access": "true",
});


// ─── Module-level constants — never recreated on render ───────────────────
const C = {
  // Backgrounds
  bg:      "#FAFAF8",   // warm off-white page background
  surface: "#FFFFFF",   // nav / modal surface
  s2:      "#FFFFFF",   // card surface
  s3:      "#F5F5F0",   // alt card / input background
  // Borders
  border:  "#E8E6E1",
  borderStrong: "#D4D1CA",
  // Text
  text:    "#1A1A18",
  muted:   "#8A8A84",
  dim:     "#B0AFA8",
  mid:     "#52524E",
  // Accent — teal-green from reference
  gold:    "#0D7C66",   // primary accent (was gold, now teal-green)
  goldBg:  "rgba(13,124,102,0.08)",
  // Semantic
  green:   "#0D7C66",  greenBg:  "rgba(13,124,102,0.10)",
  red:     "#DC2626",  redBg:    "rgba(220,38,38,0.07)",
  blue:    "#2563EB",  blueBg:   "rgba(37,99,235,0.08)",
  purple:  "#7C3AED",  purpleBg: "rgba(124,58,237,0.07)",
  teal:    "#0891B2",  tealBg:   "rgba(8,145,178,0.07)",
  amber:   "#D97706",  amberBg:  "rgba(217,119,6,0.08)",
};

const NAV_ICONS = {
  upload:    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M3 13h10M8 2v8M5 5l3-3 3 3"/></svg>,
  dashboard: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/></svg>,
  sentiment: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="8" cy="8" r="6"/><path d="M5.5 9.5c.5 1 1 1.5 2.5 1.5s2-.5 2.5-1.5M6 6.5h.01M10 6.5h.01"/></svg>,
  rootcause: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="8" cy="4" r="2"/><circle cx="3" cy="12" r="2"/><circle cx="13" cy="12" r="2"/><path d="M8 6v2M6 8l-2.5 2.5M10 8l2.5 2.5"/></svg>,
  findings:  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="6.5" cy="6.5" r="4"/><path d="M11 11l2.5 2.5"/></svg>,
  explore:   <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 4h12M2 8h8M2 12h5"/></svg>,
};

// Section divider — matches reference file's visual language
const Section = ({ children }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, marginTop: 4 }}>
    <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "1.2px", textTransform: "uppercase", color: C.muted, whiteSpace: "nowrap" }}>{children}</span>
    <div style={{ flex: 1, height: 1, background: C.border }} />
  </div>
);

const FIELDS = [
  { key: "student_name",  label: "Student Name" },
  { key: "student_email", label: "Student Email" },
  { key: "course_code",   label: "Course Code" },
  { key: "course_title",  label: "Course Title" },
  { key: "instructor",    label: "Instructor" },
  { key: "facilitators",  label: "Facilitators" },
  { key: "date",          label: "Date / Period" },
  { key: "content",       label: "Feedback Content ✱ (required)" },
];

const SOURCES = [
  { id: "survey",     label: "Course Survey",  color: "#0D7C66", icon: "📋", desc: "End-of-course evaluations" },
  { id: "lms",        label: "LMS Chat",        color: "#2563EB", icon: "💬", desc: "Learner management system chats" },
  { id: "ticket",     label: "Support Ticket",  color: "#7C3AED", icon: "🎫", desc: "Student support requests" },
  { id: "transcript", label: "Live Session",    color: "#0891B2", icon: "🎙️", desc: "Live support transcripts" },
];

const NAV_ITEMS = [
  { id: "upload",    label: "Data Upload" },
  { id: "dashboard", label: "Dashboard" },
  { id: "sentiment", label: "Sentiment" },
  { id: "rootcause", label: "Root Cause" },
  { id: "findings",  label: "Findings" },
  { id: "explore",   label: "Explorer" },
];

const VIEW_SUBTITLES = {
  upload:    "Import and manage feedback from all data sources",
  dashboard: "Overview of feedback metrics and AI insights",
  sentiment: "AI-powered emotional tone analysis",
  rootcause: "Identify systemic issues and underlying causes",
  findings:  "Key findings with supporting data and expandable deep-dives",
  explore:   "Browse and search all imported feedback records",
};

let _uid = 0;
const uid = () => `r${++_uid}_${Date.now()}`;

const dedupeKey = (r) => {
  const course = (r.course_code || "").trim().toLowerCase();
  const email  = (r.student_email || "").trim().toLowerCase();
  const name   = (r.student_name  || "").trim().toLowerCase();
  if (email) return `e:${email}|c:${course}`;
  if (name)  return `n:${name}|c:${course}`;
  return null;
};

// ─── Style helpers ────────────────────────────────────────────────────────
const card = (extra = {}) => ({
  background: C.s2, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24,
  boxShadow: "0 1px 4px rgba(0,0,0,0.05)", ...extra,
});
const inp = (extra = {}) => ({
  background: C.s3, border: `1px solid ${C.border}`, borderRadius: 8,
  padding: "9px 12px", fontSize: 13, color: C.text, fontFamily: "inherit",
  width: "100%", outline: "none", transition: "border-color 0.15s",
  ...extra,
});

// Button variants — clear hierarchy
const btn = (bg, color = "#fff", extra = {}) => ({
  background: bg, color, border: "none", borderRadius: 8, padding: "9px 18px",
  fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
  transition: "opacity 0.15s", ...extra,
});
// Primary: filled teal
const btnPrimary = (extra = {}) => btn(C.gold, "#fff", { padding: "10px 20px", ...extra });
// Secondary: outlined
const btnSecondary = (extra = {}) => btn("transparent", C.mid, { border: `1.5px solid ${C.border}`, ...extra });
// Ghost: no border, subtle
const btnGhost = (extra = {}) => btn("transparent", C.muted, { border: `1px solid ${C.border}`, ...extra });
// Danger: red-tinted
const btnDanger = (extra = {}) => btn(C.redBg, C.red, { border: `1px solid ${C.red}30`, ...extra });
// Icon button
const btnIcon = (active, color, bg, extra = {}) => btn(
  active ? bg : "transparent",
  active ? color : C.muted,
  { border: `1.5px solid ${active ? color + "50" : C.border}`, padding: "6px 14px", fontSize: 12.5, display: "flex", alignItems: "center", gap: 6, ...extra }
);

// ─── Shared atoms ─────────────────────────────────────────────────────────
const SentimentBadge = ({ s }) => {
  const c = { positive: C.green, neutral: C.amber, negative: C.red }[s] || C.muted;
  const bg = { positive: C.greenBg, neutral: C.amberBg, negative: C.redBg }[s] || C.s3;
  return <span style={{ fontSize: 11, color: c, background: bg, padding: "2px 9px", borderRadius: 20, textTransform: "capitalize", fontWeight: 600 }}>{s}</span>;
};

const SeverityBadge = ({ s }) => {
  const map = { critical: { c: C.red, bg: C.redBg }, high: { c: C.amber, bg: C.amberBg }, medium: { c: C.blue, bg: C.blueBg }, low: { c: C.muted, bg: C.s3 } };
  const { c, bg } = map[s] || { c: C.muted, bg: C.s3 };
  return <span style={{ fontSize: 10, color: c, background: bg, padding: "2px 8px", borderRadius: 20, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700 }}>{s}</span>;
};

const Pill = ({ children, color, onRemove }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, background: C.s3, border: `1px solid ${C.border}`, borderRadius: 20, padding: "3px 10px", color: color || C.text }}>
    {children}
    {onRemove && <span onClick={onRemove} style={{ cursor: "pointer", color: C.muted, lineHeight: 1 }}>×</span>}
  </span>
);

const TT = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 12px", fontSize: 12, boxShadow: "0 2px 8px rgba(0,0,0,0.08)" }}>
      {label && <div style={{ color: C.muted, marginBottom: 4 }}>{label}</div>}
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color || C.text }}>{p.name || "Count"}: <strong>{p.value}</strong></div>
      ))}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────
// ALL VIEW COMPONENTS ARE DEFINED HERE AT MODULE SCOPE — this is the key
// fix. When components are defined inside App(), React sees a new function
// reference every render, unmounts+remounts the DOM, and all inputs lose
// focus. Module-scope definitions have a stable identity across renders.
// ─────────────────────────────────────────────────────────────────────────

const FilterBar = ({ filters, setFilters, showFilters, setShowFilters, activeFiltersCount }) => {
  const toggleSource = (id) =>
    setFilters(f => ({ ...f, sources: f.sources.includes(id) ? f.sources.filter(x => x !== id) : [...f.sources, id] }));
  const clearAll = () =>
    setFilters({ sources: [], courseCode: "", courseTitle: "", instructors: "", facilitators: "", students: "", from: "", to: "" });

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button
          onClick={() => setShowFilters(v => !v)}
          style={btn(showFilters ? C.goldBg : C.s2, showFilters ? C.gold : C.muted, { border: `1px solid ${showFilters ? C.gold : C.border}`, display: "flex", alignItems: "center", gap: 6 })}>
          ⚙ Filters
          {activeFiltersCount > 0 && (
            <span style={{ background: C.gold, color: C.bg, borderRadius: "50%", width: 17, height: 17, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700 }}>
              {activeFiltersCount}
            </span>
          )}
        </button>
        {filters.sources.map(sid => {
          const s = SOURCES.find(x => x.id === sid);
          return <Pill key={sid} color={s?.color} onRemove={() => toggleSource(sid)}>{s?.icon} {s?.label}</Pill>;
        })}
        {filters.courseCode    && <Pill onRemove={() => setFilters(f => ({ ...f, courseCode:    "" }))}>Code: {filters.courseCode}</Pill>}
        {filters.courseTitle   && <Pill onRemove={() => setFilters(f => ({ ...f, courseTitle:   "" }))}>Title: {filters.courseTitle}</Pill>}
        {filters.instructors   && <Pill onRemove={() => setFilters(f => ({ ...f, instructors:   "" }))}>Instructor filtered</Pill>}
        {filters.facilitators  && <Pill onRemove={() => setFilters(f => ({ ...f, facilitators:  "" }))}>Facilitator filtered</Pill>}
        {filters.from        && <Pill onRemove={() => setFilters(f => ({ ...f, from: "" }))}>From: {filters.from}</Pill>}
        {filters.to          && <Pill onRemove={() => setFilters(f => ({ ...f, to:   "" }))}>To: {filters.to}</Pill>}
        {filters.students    && <Pill onRemove={() => setFilters(f => ({ ...f, students: "" }))}>Students filtered</Pill>}
        {activeFiltersCount > 0 && <span onClick={clearAll} style={{ fontSize: 12, color: C.red, cursor: "pointer", padding: "2px 6px" }}>Clear all</span>}
      </div>

      {showFilters && (
        <div style={{ ...card({ marginTop: 12 }), display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 20 }}>
          {/* Source */}
          <div>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600 }}>Data Source</div>
            {SOURCES.map(s => (
              <label key={s.id} style={{ display: "flex", alignItems: "center", gap: 9, cursor: "pointer", fontSize: 13, marginBottom: 12 }}>
                <input type="checkbox" checked={filters.sources.includes(s.id)} onChange={() => toggleSource(s.id)} style={{ accentColor: s.color, width: 15, height: 15 }} />
                <span style={{ fontSize: 16 }}>{s.icon}</span>{s.label}
              </label>
            ))}
          </div>
          {/* Course */}
          <div>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600 }}>Course Details</div>
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, color: C.dim, marginBottom: 5 }}>Course Code</div>
              <input
                value={filters.courseCode}
                onChange={e => setFilters(prev => ({ ...prev, courseCode: e.target.value }))}
                placeholder="e.g. CS101"
                style={inp()}
              />
            </div>
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, color: C.dim, marginBottom: 5 }}>Course Title</div>
              <input
                value={filters.courseTitle}
                onChange={e => setFilters(prev => ({ ...prev, courseTitle: e.target.value }))}
                placeholder="e.g. Data Science"
                style={inp()}
              />
            </div>
          </div>
          {/* Staff */}
          <div>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600 }}>Instructors &amp; Facilitators</div>
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, color: C.dim, marginBottom: 5 }}>Instructor names (one per line)</div>
              <textarea
                value={filters.instructors}
                onChange={e => setFilters(prev => ({ ...prev, instructors: e.target.value }))}
                placeholder={"Dr. Jane Smith\nProf. Ahmed Khan"}
                style={{ ...inp(), height: 72, resize: "vertical" }}
              />
            </div>
            <div>
              <div style={{ fontSize: 11, color: C.dim, marginBottom: 5 }}>Facilitator names (one per line)</div>
              <textarea
                value={filters.facilitators}
                onChange={e => setFilters(prev => ({ ...prev, facilitators: e.target.value }))}
                placeholder={"Alex Johnson\nMaria Lopez"}
                style={{ ...inp(), height: 72, resize: "vertical" }}
              />
            </div>
          </div>
          {/* Date & students */}
          <div>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600 }}>Date &amp; Students</div>
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, color: C.dim, marginBottom: 5 }}>From</div>
              <input type="date" value={filters.from} onChange={e => setFilters(prev => ({ ...prev, from: e.target.value }))} style={inp({ colorScheme: "dark", cursor: "pointer" })} />
            </div>
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, color: C.dim, marginBottom: 5 }}>To</div>
              <input type="date" value={filters.to} onChange={e => setFilters(prev => ({ ...prev, to: e.target.value }))} style={inp({ colorScheme: "dark", cursor: "pointer" })} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: C.dim, marginBottom: 5 }}>Students (name or email, one per line)</div>
              <textarea
                value={filters.students}
                onChange={e => setFilters(prev => ({ ...prev, students: e.target.value }))}
                placeholder={"john@example.com\nJane Smith"}
                style={{ ...inp(), height: 78, resize: "vertical" }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── ChannelBar — tab-style source switcher for all analysis pages ────────
const ChannelBar = ({ filters, setFilters, records, analysis, onSave, onClearConfirm }) => {
  const setSource = (id) => setFilters(f => {
    if (f.sources.includes(id) && f.sources.length === 1) return { ...f, sources: [] };
    if (!f.sources.length) return { ...f, sources: [id] };
    return { ...f, sources: f.sources.includes(id) ? f.sources.filter(x => x !== id) : [...f.sources, id] };
  });
  const allActive = filters.sources.length === 0;
  const ctx = [
    filters.courseCode  && filters.courseCode,
    filters.courseTitle && `"${filters.courseTitle}"`,
    filters.from && filters.to && `${filters.from} – ${filters.to}`,
  ].filter(Boolean);

  return (
    <div style={{ marginBottom: 24 }}>
      {/* Pill-tab group */}
      <div style={{ display: "flex", alignItems: "center", gap: 4, background: C.s3, borderRadius: 10, padding: 4, width: "fit-content", marginBottom: 12, border: `1px solid ${C.border}` }}>
        <button onClick={() => setFilters(f => ({ ...f, sources: [] }))} style={{
          background: allActive ? C.surface : "transparent",
          color: allActive ? C.text : C.muted, border: "none", borderRadius: 7,
          padding: "6px 16px", fontSize: 12.5, fontWeight: allActive ? 600 : 400,
          cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s",
          boxShadow: allActive ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
        }}>All channels</button>
        {SOURCES.map(s => {
          const active = filters.sources.includes(s.id);
          const cnt = records.filter(r => r.source === s.id).length;
          if (!cnt) return null;
          return (
            <button key={s.id} onClick={() => setSource(s.id)} style={{
              background: active ? C.surface : "transparent",
              color: active ? s.color : C.muted, border: "none", borderRadius: 7,
              padding: "6px 14px", fontSize: 12.5, fontWeight: active ? 600 : 400,
              cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s",
              display: "flex", alignItems: "center", gap: 5,
              boxShadow: active ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
            }}>
              <span style={{ fontSize: 13 }}>{s.icon}</span>
              {s.label}
              <span style={{ fontSize: 10.5, background: active ? `${s.color}20` : C.border, color: active ? s.color : C.dim, borderRadius: 20, padding: "1px 6px", fontWeight: 600, minWidth: 18, textAlign: "center" }}>
                {cnt}
              </span>
            </button>
          );
        })}
      </div>

      {/* Context + actions row */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {ctx.length > 0 && (
          <>
            <span style={{ fontSize: 11, color: C.dim }}>Scoped to:</span>
            {ctx.map((p, i) => (
              <span key={i} style={{ fontSize: 12, color: C.mid, background: C.goldBg, border: `1px solid ${C.gold}25`, borderRadius: 6, padding: "2px 10px", fontWeight: 500 }}>{p}</span>
            ))}
          </>
        )}
        <div style={{ flex: 1 }} />
        {analysis && (
          <button onClick={onSave} style={btn(C.greenBg, C.green, { border: `1px solid ${C.green}40`, fontSize: 12, padding: "5px 12px", display: "flex", alignItems: "center", gap: 5 })}>
            💾 Save Analysis
          </button>
        )}
        <button onClick={onClearConfirm} style={btnDanger({ fontSize: 12, padding: "5px 12px", display: "flex", alignItems: "center", gap: 5 })}>
          🗑 Clear Data
        </button>
      </div>
    </div>
  );
};

// ─── SaveModal ────────────────────────────────────────────────────────────
const SaveModal = ({ filters, analysis, records, onSave, onClose }) => {
  const [name, setName] = useState(
    [filters.courseCode, filters.courseTitle].filter(Boolean).join(" – ") || `Analysis ${new Date().toLocaleDateString()}`
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState("");

  const doSave = () => {
    if (!name.trim()) { setErr("Please enter a name."); return; }
    setSaving(true); setErr("");
    const payload = {
      name: name.trim(), ts: new Date().toISOString(),
      filters: { courseCode: filters.courseCode, courseTitle: filters.courseTitle, from: filters.from, to: filters.to },
      n: analysis.n, overall: analysis.overall,
      root_causes: analysis.root_causes,
      findings: analysis.findings || [],
      convergence: analysis.convergence || [],
      likertAverages: analysis.likertAverages || [],
      summary: analysis.summary, recommendations: analysis.recommendations,
      sources: { survey: records.filter(r=>r.source==="survey").length, lms: records.filter(r=>r.source==="lms").length, ticket: records.filter(r=>r.source==="ticket").length, transcript: records.filter(r=>r.source==="transcript").length },
    };
    const key = `edupulse:a:${Date.now()}`;
    try {
      localStorage.setItem(key, JSON.stringify(payload));
      let idx = []; try { const raw = localStorage.getItem("edupulse:index"); if (raw) idx = JSON.parse(raw); } catch {}
      idx = [{ key, name: name.trim(), ts: payload.ts, n: analysis.n, overall: analysis.overall, sources: payload.sources, rootCauseCount: (analysis.root_causes||[]).length, findingsCount: (analysis.findings||[]).length }, ...idx].slice(0, 20);
      localStorage.setItem("edupulse:index", JSON.stringify(idx));
      onSave();
    } catch (e) { setErr("Save failed: " + (e.message || "storage error")); }
    setSaving(false);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 999, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ ...card({ width: 420, padding: 32 }), boxShadow: "0 8px 32px rgba(0,0,0,0.12)" }}>
        <div style={{ fontSize: 20, fontWeight: 700, fontFamily: '"Source Serif 4", Georgia, serif', marginBottom: 4 }}>Save Analysis</div>
        <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 20, display: "flex", gap: 10 }}>
          <span>{analysis.n} records</span>
          <span style={{ color: C.green }}>· {analysis.overall.positive}% positive</span>
          <span style={{ color: C.red }}>· {analysis.overall.negative}% negative</span>
        </div>
        <div style={{ fontSize: 12, color: C.mid, fontWeight: 500, marginBottom: 7 }}>Analysis name</div>
        <input value={name} onChange={e => setName(e.target.value)} style={{ ...inp(), marginBottom: 16 }} placeholder="e.g. CS101 – Spring 2026" />
        {err && <div style={{ fontSize: 12, color: C.red, marginBottom: 12, padding: "8px 12px", background: C.redBg, borderRadius: 6 }}>{err}</div>}
        <div style={{ display: "flex", gap: 10 }}>
          <button style={{ ...btnPrimary(), flex: 1 }} onClick={doSave} disabled={saving}>{saving ? "Saving…" : "Save Analysis"}</button>
          <button style={btnSecondary()} onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
};

// ─── ClearModal ───────────────────────────────────────────────────────────
const ClearModal = ({ onConfirm, onClose }) => (
  <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 999, display: "flex", alignItems: "center", justifyContent: "center" }}>
    <div style={{ ...card({ width: 400, padding: 32 }), boxShadow: "0 8px 32px rgba(0,0,0,0.12)" }}>
      <div style={{ width: 44, height: 44, borderRadius: 12, background: C.redBg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, marginBottom: 16 }}>🗑</div>
      <div style={{ fontSize: 20, fontWeight: 700, fontFamily: '"Source Serif 4", Georgia, serif', marginBottom: 8 }}>Clear All Data?</div>
      <div style={{ fontSize: 13.5, color: C.muted, lineHeight: 1.75, marginBottom: 24 }}>
        This removes all imported records, analysis results, and filter settings from this session. Saved analyses are kept. This cannot be undone.
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        <button style={{ ...btnDanger(), flex: 1, padding: "11px 20px" }} onClick={onConfirm}>Yes, clear everything</button>
        <button style={btnSecondary({ padding: "11px 20px" })} onClick={onClose}>Cancel</button>
      </div>
    </div>
  </div>
);

// ─── SavedPanel — slide-in panel showing stored analyses ──────────────────
const SavedPanel = ({ onLoad, onClose }) => {
  const [list,     setList]     = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [preview,  setPreview]  = useState(null); // full payload for read-only view

  const loadList = () => {
    try { const raw = localStorage.getItem("edupulse:index"); setList(raw ? JSON.parse(raw) : []); }
    catch { setList([]); }
  };

  const deleteEntry = (key) => {
    setDeleting(key);
    try {
      localStorage.removeItem(key);
      let idx = []; try { const raw = localStorage.getItem("edupulse:index"); if (raw) idx = JSON.parse(raw); } catch {}
      idx = idx.filter(x => x.key !== key);
      localStorage.setItem("edupulse:index", JSON.stringify(idx));
      setList(idx);
      if (preview?.key === key) setPreview(null);
    } catch {}
    setDeleting(null);
  };

  const openPreview = (key) => {
    try { const raw = localStorage.getItem(key); if (raw) setPreview({ key, ...JSON.parse(raw) }); } catch {}
  };

  const loadEntry = (key) => {
    try { const raw = localStorage.getItem(key); if (raw) { onLoad(JSON.parse(raw)); onClose(); } } catch {}
  };

  useEffect(() => { loadList(); }, []);

  // ── Preview pane (read-only view of one saved analysis) ─────────────────
  if (preview) {
    const ov = preview.overall || {};
    const rcs = preview.root_causes || [];
    const findings = preview.findings || [];
    const likert = preview.likertAverages || [];
    const barColor = (v) => v >= 4.0 ? C.green : v >= 3.5 ? C.blue : v >= 3.0 ? C.amber : C.red;
    return (
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 999, display: "flex", alignItems: "flex-start", justifyContent: "flex-end" }}
        onClick={e => e.target === e.currentTarget && onClose()}>
        <div style={{ background: C.surface, width: 600, height: "100vh", overflowY: "auto", borderLeft: `1px solid ${C.border}`, boxSizing: "border-box", boxShadow: "-8px 0 24px rgba(0,0,0,0.1)", display: "flex", flexDirection: "column" }}>
          {/* Header */}
          <div style={{ padding: "20px 24px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexShrink: 0 }}>
            <div>
              <div style={{ fontSize: 17, fontWeight: 700, fontFamily: '"Source Serif 4", Georgia, serif', color: C.text }}>{preview.name}</div>
              <div style={{ fontSize: 11.5, color: C.muted, marginTop: 3 }}>
                {new Date(preview.ts).toLocaleDateString(undefined, { year:"numeric", month:"short", day:"numeric" })} · {preview.n} records analysed
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button onClick={() => loadEntry(preview.key)} style={btnPrimary({ fontSize: 12, padding: "6px 16px" })}>Load into App →</button>
              <button onClick={() => setPreview(null)} style={btnGhost({ fontSize: 12, padding: "6px 12px" })}>← Back</button>
              <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: C.muted, padding: 4 }}>×</button>
            </div>
          </div>

          <div style={{ padding: "20px 24px", flex: 1, overflowY: "auto" }}>
            {/* Sentiment overview */}
            <Section>Sentiment Overview</Section>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 20 }}>
              {[{l:"Positive",v:ov.positive,c:C.green},{l:"Neutral",v:ov.neutral,c:C.amber},{l:"Negative",v:ov.negative,c:C.red}].map(s => (
                <div key={s.l} style={{ background: C.bg, borderRadius: 10, padding: "14px 16px", border: `1px solid ${C.border}`, borderTop: `3px solid ${s.c}` }}>
                  <div style={{ fontSize: 28, fontWeight: 700, color: C.text, fontFamily: '"Source Serif 4", serif' }}>{s.v}<span style={{ fontSize: 14, color: s.c }}>%</span></div>
                  <div style={{ fontSize: 11.5, color: C.muted, marginTop: 3 }}>{s.l}</div>
                </div>
              ))}
            </div>

            {/* Summary */}
            {preview.summary && (
              <>
                <Section>AI Summary</Section>
                <div style={{ ...card({ marginBottom: 20, borderLeft: `3px solid ${C.gold}` }) }}>
                  <div style={{ fontSize: 13.5, lineHeight: 1.85, color: C.text }}>{preview.summary}</div>
                </div>
              </>
            )}

            {/* Root causes */}
            {rcs.length > 0 && (
              <>
                <Section>Root Causes — {rcs.length} issues</Section>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
                  {rcs.map((rc, i) => {
                    const sevC = { critical: C.red, high: C.amber, medium: C.blue, low: C.muted }[rc.severity] || C.muted;
                    return (
                      <div key={i} style={{ background: C.bg, border: `1px solid ${C.border}`, borderLeft: `3px solid ${sevC}`, borderRadius: "3px 10px 10px 3px", padding: "12px 16px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{rc.theme}</span>
                          <div style={{ display: "flex", gap: 6 }}>
                            <SeverityBadge s={rc.severity} />
                            <span style={{ fontSize: 11, color: C.muted, background: C.s3, padding: "1px 7px", borderRadius: 20, border: `1px solid ${C.border}` }}>×{rc.count}</span>
                          </div>
                        </div>
                        <div style={{ fontSize: 12, color: C.mid, lineHeight: 1.6 }}>{rc.description}</div>
                        {(rc.data_points||[]).length > 0 && (
                          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 3 }}>
                            {rc.data_points.map((dp, j) => (
                              <div key={j} style={{ fontSize: 11.5, color: C.muted, paddingLeft: 10, borderLeft: `2px solid ${C.border}` }}>{dp}</div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {/* Findings */}
            {findings.length > 0 && (
              <>
                <Section>Findings — {findings.length} insights</Section>
                <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 20 }}>
                  {findings.map((f, i) => (
                    <div key={i} style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 18px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 8 }}>
                        <span style={{ fontSize: 13.5, fontWeight: 700, color: C.text }}>{f.title}</span>
                        {f.channels && <span style={{ fontSize: 11, color: C.blue, background: C.blueBg, padding: "2px 9px", borderRadius: 20, flexShrink: 0 }}>{f.channels}</span>}
                      </div>
                      <div style={{ fontSize: 12.5, color: C.mid, lineHeight: 1.7, marginBottom: 8 }}>{f.detail}</div>
                      {(f.considerations||[]).length > 0 && (
                        <div style={{ background: `${C.gold}06`, border: `1px solid ${C.gold}20`, borderRadius: 8, padding: "10px 14px" }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: C.gold, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Considerations</div>
                          {f.considerations.map((c, j) => (
                            <div key={j} style={{ display: "flex", gap: 7, alignItems: "flex-start", marginBottom: j < f.considerations.length - 1 ? 4 : 0 }}>
                              <div style={{ width: 5, height: 5, borderRadius: "50%", background: C.gold, flexShrink: 0, marginTop: 6 }} />
                              <span style={{ fontSize: 12, color: C.mid }}>{c}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Likert */}
            {likert.length > 0 && (
              <>
                <Section>Survey Ratings</Section>
                <div style={{ ...card({ marginBottom: 20 }) }}>
                  {likert.map((d, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: i < likert.length - 1 ? 10 : 0 }}>
                      <div style={{ width: 200, fontSize: 12, fontWeight: 500, color: C.text, textAlign: "right", flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={d.dim}>{d.dim}</div>
                      <div style={{ flex: 1, height: 16, background: C.s3, borderRadius: 4, overflow: "hidden" }}>
                        <div style={{ width: `${((d.avg - 1) / 4) * 100}%`, height: "100%", background: barColor(d.avg), borderRadius: 4, opacity: 0.75 }} />
                      </div>
                      <div style={{ width: 36, fontSize: 13, fontWeight: 700, color: barColor(d.avg), textAlign: "right" }}>{d.avg}</div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Recommendations */}
            {(preview.recommendations||[]).length > 0 && (
              <>
                <Section>Recommendations</Section>
                <div style={{ ...card({ marginBottom: 20 }) }}>
                  {preview.recommendations.map((r, i) => (
                    <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: i < preview.recommendations.length - 1 ? 10 : 0 }}>
                      <div style={{ width: 20, height: 20, borderRadius: "50%", background: C.goldBg, border: `1px solid ${C.gold}40`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: C.gold, flexShrink: 0, marginTop: 1 }}>{i + 1}</div>
                      <span style={{ fontSize: 13, color: C.mid, lineHeight: 1.6 }}>{r}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Load CTA at bottom */}
            <div style={{ background: C.goldBg, border: `1px solid ${C.gold}30`, borderRadius: 10, padding: "14px 18px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 12.5, color: C.mid }}>Load this analysis to explore Sentiment, Root Cause, Explorer, and more.</div>
              <button onClick={() => loadEntry(preview.key)} style={btnPrimary({ fontSize: 12, padding: "8px 18px", flexShrink: 0, marginLeft: 16 })}>Load into App →</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── List pane ─────────────────────────────────────────────────────────────
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 999, display: "flex", alignItems: "flex-start", justifyContent: "flex-end" }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: C.surface, width: 420, height: "100vh", overflowY: "auto", borderLeft: `1px solid ${C.border}`, padding: 28, boxSizing: "border-box", boxShadow: "-8px 0 24px rgba(0,0,0,0.08)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, fontFamily: '"Source Serif 4", Georgia, serif' }}>Saved Analyses</div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>Click any analysis to read it in full</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: C.muted, lineHeight: 1, padding: 4 }}>×</button>
        </div>
        {list === null && <div style={{ fontSize: 13, color: C.muted, textAlign: "center", padding: 40 }}>Loading…</div>}
        {list !== null && list.length === 0 && (
          <div style={{ textAlign: "center", padding: "48px 20px" }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>📂</div>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>No saved analyses yet</div>
            <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.6 }}>Run an analysis and click 💾 Save<br/>to store it here for future reference.</div>
          </div>
        )}
        {(list || []).map((item) => {
          const ov = item.overall || {};
          return (
            <div key={item.key} style={{ background: C.bg, borderRadius: 10, padding: 16, marginBottom: 10, border: `1px solid ${C.border}`, cursor: "pointer", transition: "border-color 0.15s" }}
              onClick={() => openPreview(item.key)}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4, color: C.text }}>{item.name}</div>
              <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 10 }}>
                {new Date(item.ts).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })} · {item.n} records
              </div>
              {ov.positive !== undefined && (
                <div style={{ display: "flex", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 11, color: C.green, background: C.greenBg, padding: "2px 8px", borderRadius: 20, fontWeight: 600 }}>😊 {ov.positive}%</span>
                  <span style={{ fontSize: 11, color: C.amber, background: C.amberBg, padding: "2px 8px", borderRadius: 20, fontWeight: 600 }}>😐 {ov.neutral}%</span>
                  <span style={{ fontSize: 11, color: C.red, background: C.redBg, padding: "2px 8px", borderRadius: 20, fontWeight: 600 }}>😞 {ov.negative}%</span>
                  {item.rootCauseCount > 0 && <span style={{ fontSize: 11, color: C.muted, background: C.s3, padding: "2px 8px", borderRadius: 20 }}>{item.rootCauseCount} issues</span>}
                  {item.findingsCount > 0 && <span style={{ fontSize: 11, color: C.blue, background: C.blueBg, padding: "2px 8px", borderRadius: 20 }}>{item.findingsCount} findings</span>}
                </div>
              )}
              <div style={{ display: "flex", gap: 8 }}>
                <button style={{ ...btn(C.goldBg, C.gold, { border: `1px solid ${C.gold}30`, fontSize: 12, padding: "6px 14px", flex: 1 }) }}
                  onClick={e => { e.stopPropagation(); openPreview(item.key); }}>
                  👁 View Analysis
                </button>
                <button style={{ ...btnPrimary({ fontSize: 12, padding: "6px 14px" }) }}
                  onClick={e => { e.stopPropagation(); loadEntry(item.key); }}>
                  Load →
                </button>
                <button style={{ ...btnDanger({ fontSize: 12, padding: "6px 10px" }) }}
                  onClick={e => { e.stopPropagation(); deleteEntry(item.key); }}
                  disabled={!!deleting}>
                  {deleting === item.key ? "…" : "🗑"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ─── Auto column detection helpers ───────────────────────────────────────
const FIELD_PATTERNS = {
  student_name:  ["learner's name", "learner name", "learner", "student name", "full name", "respondent name", "student"],
  student_email: ["email address", "email", "e-mail", "student email", "respondent email"],
  course_code:   ["course code", "course_code", "coursecode", "course id", "subject code", "aint 101", "aint101"],
  course_title:  ["course title", "course name", "course_title", "subject name", "program name"],
  instructor:    ["intructor", "instructor name", "instructor", "responded by", "resolved by", "teacher", "faculty", "professor", "lecturer"],
  facilitators:  ["facilitators", "facilitator name", "facilitator", "co-facilitator", "teaching assistant"],
  date:          ["learner chat date", "created date", "chat date", "timestamp", "submitted", "submission date", "survey date", "response date", "date"],
  content:       ["learner chat", "ticket", "what aspect", "what are", "recommend", "improvement", "most useful", "most challenging", "response", "feedback", "comment", "comments", "answer", "survey response", "feedback text", "message", "remarks", "notes", "open ended", "verbatim", "description"],
};

// Returns how "data-rich" a column is: non-empty row count × average text length.
// Used to rank content candidates — a column full of blanks scores near 0.
const colScore = (header, data) => {
  const sample = data.slice(0, 15);
  const nonEmpty = sample.filter(r => String(r[header] || "").trim().length > 0).length;
  const avgLen   = sample.reduce((s, r) => s + String(r[header] || "").length, 0) / sample.length;
  return nonEmpty * avgLen;
};

// True if a column header is an auto-generated placeholder (SheetJS names
// unnamed columns __EMPTY, __EMPTY_1, __EMPTY_2, etc.)
const isPlaceholder = h => /^__EMPTY/.test(h) || /^Unnamed:\s*\d+/.test(h);

const heuristicDetect = (headers, data) => {
  const norm = s => s.toLowerCase().replace(/[_\-\s]+/g, " ").trim();
  // Identifier columns (email, name, date, instructor, etc.) always have short headers.
  // Long headers (> 55 chars) are almost certainly survey question text — exclude them
  // from identifier mapping to prevent e.g. "On a scale of 1-5… instructor?" being
  // matched to the `instructor` field.
  const isQuestion = h => h.length > 55;
  const used = new Set();
  const map  = {};

  // Named-pattern matching — skip placeholders and long question headers for all
  // fields except `content` (content uses all text-rich columns separately).
  // Short patterns (< 5 chars) require an exact match to prevent false substring
  // hits like "ta" matching "timestamp" or "code" matching "course_code".
  for (const [field, patterns] of Object.entries(FIELD_PATTERNS)) {
    if (field === "content") continue;
    for (const pat of patterns) {
      const match = headers.find(h => {
        if (used.has(h) || isPlaceholder(h) || isQuestion(h)) return false;
        const hn = norm(h);
        if (pat.length < 5) return hn === pat; // exact match only for short patterns
        return hn.includes(pat) || pat.includes(hn);
      });
      if (match) { map[field] = match; used.add(match); break; }
    }
  }

  // Fallback for content: rank unmapped, non-placeholder columns by data richness
  if (!map.content && data.length) {
    const candidates = headers
      .filter(h => !used.has(h) && !isPlaceholder(h))
      .map(h => ({ h, score: colScore(h, data) }))
      .sort((a, b) => b.score - a.score);

    const best = candidates[0];
    const sampleSize = Math.min(data.length, 15);
    const nonEmpty = data.slice(0, sampleSize).filter(r => String(r[best?.h] || "").trim().length > 0).length;
    if (best && nonEmpty / sampleSize >= 0.3) map.content = best.h;
  }

  return map;
};

// After any detection method: gather ALL text-rich unmapped columns as contentCols.
// For surveys with multiple open-ended questions this concatenates all of them so
// a row isn't rejected just because one question was left blank.
const collectContentCols = (colMap, headers, data) => {
  if (!data.length || !colMap.content) return colMap;

  const primaryScore = colScore(colMap.content, data);
  // Include any unmapped column whose richness is ≥ 15% of the primary column
  const threshold = Math.max(20, primaryScore * 0.15);
  const mapped = new Set(Object.values(colMap).filter(Boolean));

  const extras = headers
    .filter(h => !mapped.has(h) && !isPlaceholder(h))
    .filter(h => colScore(h, data) >= threshold)
    .sort((a, b) => colScore(b, data) - colScore(a, data));

  return { ...colMap, contentCols: [colMap.content, ...extras] };
};

const detectWithClaude = async (headers, data) => {
  // Only show Claude columns that actually have data — exclude placeholders and empty columns
  const usefulHeaders = headers.filter(h => !isPlaceholder(h) && colScore(h, data) > 0);

  const sample = data.slice(0, 4).map(row =>
    usefulHeaders.map(h => {
      const val = String(row[h] || "").slice(0, 80);
      return val ? `${h}: ${val}` : null;
    }).filter(Boolean).join(" | ")
  ).filter(Boolean).join("\n");

  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: apiHeaders(),
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 300,
      system: `You map spreadsheet columns to standard fields for an education feedback platform.
Fields: student_name, student_email, course_code, course_title, instructor, facilitators, date, content.
"content" is the most important field — it holds the actual feedback text, chat messages, or support ticket body.
Respond ONLY with a valid JSON object. Keys are field names, values are the EXACT column header string from the input.
Only include fields you are confident about. Never map an empty or numeric-only column to "content".`,
      messages: [{ role: "user", content: `Available columns (with sample data):\n${sample}\n\nAll column names: ${usefulHeaders.join(", ")}` }]
    })
  });
  const d = await res.json();
  const raw = (d.content || []).map(b => b.text || "").join("");
  return JSON.parse(raw.replace(/```json|```/g, "").trim());
};

// Converts free-text dates (e.g. "10th March", "6th March 2026", "26-02-2026",
// "2026-03-10") into ISO "YYYY-MM-DD" strings for comparison.
// Returns null when the date cannot be recognised.
const parseTextDate = (raw) => {
  if (!raw) return null;

  // Already a JS Date object (from cellDates:true XLSX read)
  if (raw instanceof Date) {
    return isNaN(raw) ? null : raw.toISOString().slice(0, 10);
  }

  // Strip time portion — "24-03-26, 10:32:28 AM" → "24-03-26"
  // Also handles "2026-03-24T10:32:28" and "24/03/2026 10:32"
  let s = String(raw).trim()
    .replace(/[,\s]+\d{1,2}:\d{2}(:\d{2})?(\s*(AM|PM))?/i, "") // remove ", HH:MM:SS AM/PM"
    .replace(/T\d{2}:\d{2}.*/, "")  // remove ISO time part
    .trim();

  if (!s) return null;

  // ── ISO: 2026-03-24 ─────────────────────────────────────────────────
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);

  // ── Separator-based formats (-, /, .) ───────────────────────────────
  const SEP = /^(\d{1,4})[-/.](\d{1,2})[-/.](\d{1,4})$/;
  const m = s.match(SEP);
  if (m) {
    let [, a, b, c] = m;
    a = parseInt(a, 10); b = parseInt(b, 10); c = parseInt(c, 10);

    // 4-digit year on the left: YYYY-MM-DD
    if (a > 31)  return `${a}-${String(b).padStart(2,"0")}-${String(c).padStart(2,"0")}`;

    // 4-digit year on the right: DD-MM-YYYY or MM-DD-YYYY
    // Heuristic: if left part > 12 it must be a day → DD-MM-YYYY
    if (c > 31) {
      const yr = c;
      if (a > 12) return `${yr}-${String(b).padStart(2,"0")}-${String(a).padStart(2,"0")}`;
      return `${yr}-${String(a).padStart(2,"0")}-${String(b).padStart(2,"0")}`; // assume MM-DD-YYYY
    }

    // 2-digit year — formats: DD-MM-YY, YY-MM-DD
    // If left part > 31 it's a year; if left part > 12 it must be a day
    if (a <= 31 && b <= 12 && c <= 99) {
      // DD-MM-YY: a=day, b=month, c=2-digit year
      const yr = c < 50 ? 2000 + c : 1900 + c;
      return `${yr}-${String(b).padStart(2,"0")}-${String(a).padStart(2,"0")}`;
    }
    if (a <= 99 && b <= 12 && c <= 31) {
      // YY-MM-DD: a=2-digit year, b=month, c=day
      const yr = a < 50 ? 2000 + a : 1900 + a;
      return `${yr}-${String(b).padStart(2,"0")}-${String(c).padStart(2,"0")}`;
    }
  }

  // ── Ordinal text dates: "10th March", "3rd March 2026" ──────────────
  const MONTHS = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
  const ord = s.match(/(\d{1,2})(?:st|nd|rd|th)\s+([a-zA-Z]+)(?:\s+(\d{2,4}))?/);
  if (ord) {
    const mon = MONTHS[ord[2].slice(0,3).toLowerCase()];
    if (mon) {
      let yr = ord[3] ? parseInt(ord[3], 10) : new Date().getFullYear();
      if (yr < 100) yr = yr < 50 ? 2000 + yr : 1900 + yr;
      return `${yr}-${String(mon).padStart(2,"0")}-${ord[1].padStart(2,"0")}`;
    }
  }

  // ── Month-name first: "March 10", "February 6 2026" ─────────────────
  const mdy = s.match(/([a-zA-Z]+)\s+(\d{1,2})(?:,?\s+(\d{2,4}))?/);
  if (mdy) {
    const mon = MONTHS[mdy[1].slice(0,3).toLowerCase()];
    if (mon) {
      let yr = mdy[3] ? parseInt(mdy[3], 10) : new Date().getFullYear();
      if (yr < 100) yr = yr < 50 ? 2000 + yr : 1900 + yr;
      return `${yr}-${String(mon).padStart(2,"0")}-${mdy[2].padStart(2,"0")}`;
    }
  }

  return null;
};

// ─── Source-specific import logic ────────────────────────────────────────
//
//  SURVEY
//    • Accept every row that has feedback content.
//    • Deduplicate only by email + course_code (rolling files re-include
//      old responses — skip if that email+course combo is already stored).
//    • No email?  Always accept; no name-based deduplication.
//
//  LMS CHAT / LIVE SESSION — filters applied in this order:
//    1st — Staff match: both Instructors and Facilitators filter lists are pooled
//          and matched against the instructor column. A row is kept only when at
//          least one pooled name appears in the instructor column.
//    2nd — Student list: student name or email must be in the Students filter.
//    3rd — Date range: text dates ("10th March") are normalised before comparing.
//    Deduplication by email+course (falls back to name+course).
//
//  SUPPORT TICKET
//    No staff filter — instructor names are not present in ticket data.
//    1st — Student list.
//    2nd — Date range.
//    Deduplication by email+course.
//
const doImport = (rawData, colMap, source, existingRecords, filters) => {
  // ── Dedup key sets ────────────────────────────────────────────────────
  const surveyEmailKeys = new Set(
    existingRecords
      .filter(r => r.source === "survey" && r.student_email)
      .map(r => `${r.student_email.trim().toLowerCase()}|${(r.course_code || "").trim().toLowerCase()}`)
  );
  const otherKeys = new Map(
    existingRecords.filter(r => r.source !== "survey").map(r => [dedupeKey(r), r.id])
  );

  // ── Parse filter lists once ───────────────────────────────────────────
  const splitList = str => (str || "").toLowerCase().split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);
  const instrList   = splitList(filters.instructors);
  const facList     = splitList(filters.facilitators);
  const staffList   = [...instrList, ...facList];
  const studentList = splitList(filters.students);

  let dups = 0;
  const rejected = { noContent: 0, noStaff: 0, noStudent: 0, outOfRange: 0, noDate: 0 };
  const newRecs = [];

  rawData.forEach(row => {
    const r = { id: uid(), source, _importedAt: new Date().toISOString() };

    // Map non-content fields, converting JS Date objects (from cellDates:true) to ISO strings
    FIELDS.forEach(f => {
      if (f.key === "content" || !colMap[f.key]) return;
      const raw = row[colMap[f.key]];
      if (raw instanceof Date && !isNaN(raw)) {
        r[f.key] = raw.toISOString().slice(0, 10); // "2026-03-18"
      } else {
        r[f.key] = String(raw ?? "").trim();
      }
    });

    if (source === "survey") {
      // ── SURVEY ───────────────────────────────────────────────────────
      // The user uploads the correct course survey file themselves — no course
      // code matching needed. Accept all rows with any data.
      // Deduplication by email + course handles rolling re-uploads.

      // Only exclude true metadata from content: email and timestamp.
      // Do NOT exclude course_code, instructor, facilitators — those are often
      // incorrectly matched to long question headers (e.g. "On a scale of 1-5...
      // instructor?") by the heuristic, and those question columns must be
      // included in the analysable content, not stripped out.
      const trueMetadataCols = new Set(
        ["student_email", "student_name", "date"]
          .map(f => colMap[f]).filter(Boolean)
      );
      const surveyParts = Object.keys(row)
        .filter(col => !isPlaceholder(col) && !trueMetadataCols.has(col))
        .map(col => {
          const raw = row[col];
          const val = raw instanceof Date ? raw.toISOString().slice(0, 10) : String(raw || "").trim();
          return val ? `${col}: ${val}` : null;
        })
        .filter(Boolean);
      r.content = surveyParts.join("\n");

      if (!r.content) { rejected.noContent++; return; }

      // No date filtering for surveys — the user uploads exactly the right file
      // for the course and term. Accept all rows that have any response data.

      // Deduplication: email + course
      const email  = (r.student_email || "").trim().toLowerCase();
      const course = (r.course_code   || "").trim().toLowerCase();
      if (email) {
        const key = `${email}|${course}`;
        if (surveyEmailKeys.has(key)) { dups++; return; }
        surveyEmailKeys.add(key);
      }
      newRecs.push(r);

    } else {
      // ── CHAT / TICKET / TRANSCRIPT ────────────────────────────────────
      //
      // CHAT / LIVE SESSION
      //   Filter 1 (Staff): instructor column must match a name from the Instructors
      //     or Facilitators filter. Staff names are course-specific, so this naturally
      //     scopes to the correct course.
      //   Filter 2 (Students): student must be in the enrolled student list.
      //   Filter 3 (Date): row must fall within the From/To range.
      //
      // SUPPORT TICKET
      //   Ticket files may contain tickets from other courses (same dates) or
      //   from the correct course but a different term (different dates).
      //   Filter 1 (Students): enrolled student list removes other-course tickets,
      //     since the list is specific to this course's cohort.
      //   Filter 2 (Date): date range removes out-of-term tickets.
      //   No staff filter — instructor names are not present in ticket data.

      const contentCols = colMap.contentCols || (colMap.content ? [colMap.content] : []);
      const contentParts = contentCols.map(col => String(row[col] || "").trim()).filter(Boolean);
      r.content = contentParts.join("\n\n");
      if (!r.content) { rejected.noContent++; return; }

      // Filter 1: Staff match (Chat and Live Session only)
      if (source !== "ticket" && staffList.length > 0) {
        const instrCell = (r.instructor || "").toLowerCase();
        const matched = instrCell.length > 0 && staffList.some(s =>
          instrCell.includes(s) || (instrCell.length > 2 && s.includes(instrCell))
        );
        if (!matched) { rejected.noStaff++; return; }
      }

      // Filter 2: Student list
      if (studentList.length > 0) {
        const nameLow  = (r.student_name  || "").toLowerCase();
        const emailLow = (r.student_email || "").toLowerCase();
        if (!studentList.some(s => nameLow.includes(s) || emailLow.includes(s))) {
          rejected.noStudent++; return;
        }
      }

      // Filter 3: Date range
      // Rows with no date or an unparseable date are rejected when a range is set —
      // we cannot verify they belong to the correct term.
      if (filters.from || filters.to) {
        if (!r.date || r.date.trim() === "" || r.date.trim() === "-") {
          rejected.noDate++; return;
        }
        const iso = parseTextDate(r.date);
        if (!iso) { rejected.noDate++; return; }
        if (filters.from && iso < filters.from) { rejected.outOfRange++; return; }
        if (filters.to   && iso > filters.to)   { rejected.outOfRange++; return; }
      }

      const key = dedupeKey(r);
      if (key && otherKeys.has(key)) { dups++; return; }
      if (key) otherKeys.set(key, r.id);
      newRecs.push(r);
    }
  });

  return { newRecs, dups, rejected };
};

// ─── Upload ───────────────────────────────────────────────────────────────
const UploadView = ({ up, setUp, records, setRecords, setAnalysis, setView, filters }) => {
  const fileRef = useRef();

  const processFile = async (file) => {
    setUp(s => ({ ...s, step: "detecting", fileName: file.name }));

    // 1. Parse file
    const parseResult = await new Promise((resolve) => {
      const ext = file.name.split(".").pop().toLowerCase();
      if (ext === "csv") {
        Papa.parse(file, {
          header: true, skipEmptyLines: true,
          complete: r => resolve({ data: r.data, headers: r.meta.fields || [] })
        });
      } else {
        const fr = new FileReader();
        fr.onload = e => {
          // cellDates:true → date cells become JS Date objects instead of Excel serial numbers
          const wb = XLSX.read(e.target.result, { type: "binary", cellDates: true });

          // Pick the sheet with the most non-empty data rows (skips summary/formula sheets)
          let bestSheet = wb.SheetNames[0];
          let bestCount = 0;
          wb.SheetNames.forEach(name => {
            const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: "", cellDates: true });
            const nonEmpty = rows.filter(r => Object.values(r).some(v => String(v).trim().length > 0)).length;
            if (nonEmpty > bestCount) { bestCount = nonEmpty; bestSheet = name; }
          });

          const data = XLSX.utils.sheet_to_json(wb.Sheets[bestSheet], { defval: "", cellDates: true });
          resolve({ data, headers: data.length ? Object.keys(data[0]) : [], sheetName: bestSheet });
        };
        fr.readAsBinaryString(file);
      }
    });

    const { data, headers, sheetName } = parseResult;
    if (!data.length || !headers.length) {
      setUp(s => ({ ...s, step: "error", errorMsg: "File appears to be empty or has no headers." }));
      return;
    }

    // 2. Detect columns — heuristic first, then Claude, with emptiness validation at each step
    const contentIsUsable = (map) => {
      if (!map.content) return false;
      if (isPlaceholder(map.content)) return false;
      const sample = data.slice(0, 15);
      const nonEmpty = sample.filter(r => String(r[map.content] || "").trim().length > 0).length;
      return nonEmpty / sample.length >= 0.2;
    };

    let colMap = heuristicDetect(headers, data);

    if (!contentIsUsable(colMap)) {
      try {
        setUp(s => ({ ...s, step: "detecting", statusMsg: "Identifying columns with AI…" }));
        const claudeMap = await detectWithClaude(headers, data);
        colMap = { ...colMap, ...claudeMap };
      } catch { /* fall through */ }
    }

    if (!contentIsUsable(colMap)) {
      const best = headers
        .filter(h => !isPlaceholder(h))
        .map(h => ({ h, score: colScore(h, data) }))
        .sort((a, b) => b.score - a.score)[0];
      if (best && best.score > 0) colMap.content = best.h;
    }

    if (!contentIsUsable(colMap)) {
      setUp(s => ({
        ...s, step: "error",
        errorMsg: "Could not find a column with usable feedback text. All detected columns appear to be empty or contain only numbers/dates. Check that your file has a column with actual text responses.",
      }));
      return;
    }

    // Collect all additional text-rich columns to concatenate as content (e.g. survey multi-question)
    colMap = collectContentCols(colMap, headers, data);

    // 3. Import with source-specific filtering and deduplication
    const { newRecs, dups, rejected } = doImport(data, colMap, up.source, records, filters);
    setRecords(prev => [...prev, ...newRecs]);
    setAnalysis(null);
    setUp(s => ({
      ...s, step: "done",
      added: newRecs.length, dups, rejected,
      totalRows: data.length,
      detectedMap: colMap,
      fileName: file.name,
      sheetName: sheetName || null,
      source: up.source,
    }));
  };

  const FIELD_LABELS = { student_name: "Student Name", student_email: "Email", course_code: "Course Code", course_title: "Course Title", instructor: "Instructor", facilitators: "Facilitators", date: "Date", content: "Feedback Content" };

  return (
    <div>
      {/* Source type selector */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 20 }}>
        {SOURCES.map(s => (
          <div key={s.id} onClick={() => setUp(p => ({ ...p, source: s.id }))} style={{
            ...card({ padding: "16px 14px", textAlign: "center", cursor: "pointer", transition: "all 0.2s" }),
            border: `1px solid ${up.source === s.id ? s.color : C.border}`,
            background: up.source === s.id ? `${s.color}14` : C.s2,
          }}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>{s.icon}</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: up.source === s.id ? s.color : C.text, marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 11, color: C.muted }}>{s.desc}</div>
          </div>
        ))}
      </div>

      {/* Filter readiness warnings — shown before upload for sources that depend on filters */}
      {up.step === "drop" && (() => {
        const needsStaff   = (up.source === "lms" || up.source === "transcript") && !filters.instructors && !filters.facilitators;
        const needsStudent = (up.source === "lms" || up.source === "transcript" || up.source === "ticket") && !filters.students;
        const needsDate    = (up.source === "ticket") && !filters.from && !filters.to;
        if (!needsStaff && !needsStudent && !needsDate) return null;
        const items = [
          needsStaff   && "No Instructor or Facilitator names entered — all messages will pass through regardless of who they were sent to.",
          needsStudent && "No Student list entered — messages from students outside this cohort won't be excluded.",
          needsDate    && "No date range set — support tickets from other terms won't be excluded.",
        ].filter(Boolean);
        return (
          <div style={{ background: C.amberBg, border: `1px solid ${C.amber}50`, borderRadius: 10, padding: "14px 18px", marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.amber, marginBottom: 8 }}>⚠ Set filters before uploading for accurate results</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {items.map((item, i) => (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <span style={{ color: C.amber, flexShrink: 0, marginTop: 1 }}>·</span>
                  <span style={{ fontSize: 12.5, color: C.mid, lineHeight: 1.6 }}>{item}</span>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 10 }}>
              Use the <strong>⚙ Filters</strong> panel above to add instructor names, a student list, and/or a date range first.
            </div>
          </div>
        );
      })()}

      {/* Drop zone */}
      {up.step === "drop" && (
        <div
          onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) processFile(f); }}
          onDragOver={e => e.preventDefault()}
          onClick={() => fileRef.current?.click()}
          style={{ ...card({ padding: 56, textAlign: "center", cursor: "pointer", border: `2px dashed ${C.border}` }) }}>
          <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" style={{ display: "none" }} onChange={e => e.target.files[0] && processFile(e.target.files[0])} />
          <div style={{ fontSize: 40, marginBottom: 14 }}>📂</div>
          <div style={{ fontSize: 17, fontWeight: 600, fontFamily: '"Source Serif 4", Georgia, serif', marginBottom: 8 }}>Drop your file here</div>
          <div style={{ fontSize: 13, color: C.muted }}>Supports CSV, XLSX · No setup needed — columns are detected automatically</div>
        </div>
      )}

      {/* Processing / detecting */}
      {up.step === "detecting" && (
        <div style={{ ...card({ textAlign: "center", padding: "52px 40px" }) }}>
          <div style={{ fontSize: 36, marginBottom: 16 }}>⏳</div>
          <div style={{ fontSize: 16, fontWeight: 600, fontFamily: '"Source Serif 4", Georgia, serif', marginBottom: 8 }}>
            {up.statusMsg || "Reading file…"}
          </div>
          <div style={{ fontSize: 12, color: C.muted }}>{up.fileName}</div>
        </div>
      )}

      {/* Error */}
      {up.step === "error" && (
        <div style={{ ...card({ border: `1px solid ${C.red}50` }) }}>
          <div style={{ fontSize: 14, color: C.red, marginBottom: 14 }}>⚠ {up.errorMsg}</div>
          <button style={btn(C.s3, C.muted)} onClick={() => setUp(s => ({ ...s, step: "drop" }))}>← Try Another File</button>
        </div>
      )}

      {/* Done */}
      {up.step === "done" && (() => {
        const rej = up.rejected || {};
        const isSurvey = up.source === "survey";
        const totalRejected = (up.dups || 0) + Object.values(rej).reduce((a, b) => a + b, 0);
        const FIELD_LABELS = { student_name: "Student Name", student_email: "Email", course_code: "Course Code", course_title: "Course Title", instructor: "Instructor", facilitators: "Facilitators", date: "Date", content: "Feedback Content" };

        const RejRow = ({ label, count, color, note }) => count > 0 ? (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "9px 0", borderBottom: `1px solid ${C.border}` }}>
            <div>
              <span style={{ fontSize: 13 }}>{label}</span>
              {note && <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{note}</div>}
            </div>
            <span style={{ fontSize: 13, fontWeight: 600, color, flexShrink: 0, marginLeft: 16 }}>{count} rows</span>
          </div>
        ) : null;

        return (
          <div style={card()}>
            <div style={{ fontSize: 16, fontWeight: 700, fontFamily: '"Source Serif 4", Georgia, serif', marginBottom: 4 }}>Import Complete</div>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 18 }}>
              {up.fileName}{up.sheetName ? <span style={{ color: C.blue }}> · sheet "{up.sheetName}"</span> : ""} · {up.totalRows} rows processed
            </div>

            {/* Accepted / rejected totals */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
              <div style={{ background: C.greenBg, border: `1px solid ${C.green}40`, borderRadius: 10, padding: "16px 18px", textAlign: "center" }}>
                <div style={{ fontSize: 34, fontWeight: 700, color: C.green, fontFamily: '"Source Serif 4", Georgia, serif' }}>{up.added}</div>
                <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>Records Imported</div>
              </div>
              <div style={{ background: C.redBg, border: `1px solid ${C.red}40`, borderRadius: 10, padding: "16px 18px", textAlign: "center" }}>
                <div style={{ fontSize: 34, fontWeight: 700, color: C.red, fontFamily: '"Source Serif 4", Georgia, serif' }}>{totalRejected}</div>
                <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>Rows Rejected</div>
              </div>
            </div>

            {/* Warn if nothing was filtered on a source that normally would be */}
            {!isSurvey && totalRejected === 0 && up.added > 0 && !filters.instructors && !filters.facilitators && !filters.students && !filters.from && !filters.to && (
              <div style={{ background: C.amberBg, border: `1px solid ${C.amber}40`, borderRadius: 10, padding: "12px 16px", marginBottom: 18, fontSize: 12.5, color: C.mid, lineHeight: 1.6 }}>
                <strong style={{ color: C.amber }}>⚠ No filters were active</strong> — all {up.added} rows were imported without any staff, student, or date filtering. If this file contains messages from multiple courses or terms, re-upload with filters set.
              </div>
            )}

            {/* Rejection breakdown */}
            {totalRejected > 0 && (
              <div style={{ background: C.s3, borderRadius: 10, padding: "4px 16px", marginBottom: 18 }}>
                <div style={{ fontSize: 11, color: C.muted, padding: "10px 0 6px", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600 }}>Why rows were rejected</div>
                <RejRow label="Duplicate (same student already imported)" color={C.gold} count={up.dups}
                  note={isSurvey ? "Matched by student email + course code" : "Matched by email or name + course code"} />
                {rej.noContent > 0 && <RejRow label="No feedback content" color={C.muted} count={rej.noContent}
                  note={isSurvey ? "Row had no data in any column — completely empty row" : "Row had no text in the detected feedback column"} />}
                {!isSurvey && <>
                  <RejRow label="Staff not matched (Chat / Live Session only)" color={C.red} count={rej.noStaff}
                    note="Instructor column didn't match any name from the Instructors or Facilitators filter. Tickets skip this filter." />
                  <RejRow label="Student not in enrolled list" color={C.red} count={rej.noStudent}
                    note="For tickets: removes records from other courses (students not in this cohort). For chat: removes non-enrolled students." />
                  <RejRow label="No date or unrecognisable date format" color={C.gold} count={rej.noDate}
                    note="Row had no date or a format that couldn't be parsed — rejected to prevent out-of-term records leaking in." />
                  <RejRow label="Outside date range" color={C.red} count={rej.outOfRange}
                    note="For tickets: removes correct-course tickets from a different term. Row date was before From or after To." />
                </>}
              </div>
            )}

            {/* Detected column mapping */}
            {up.detectedMap && Object.keys(up.detectedMap).length > 0 && (
              <div style={{ background: C.s3, borderRadius: 10, padding: 14, marginBottom: 18 }}>
                <div style={{ fontSize: 11, color: C.muted, marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600 }}>Auto-detected Column Mapping</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {Object.entries(up.detectedMap)
                    .filter(([field]) => field !== "contentCols") // shown separately below
                    .map(([field, col]) => (
                      <div key={field} style={{ display: "flex", alignItems: "center", gap: 6, background: C.s2, border: `1px solid ${C.border}`, borderRadius: 8, padding: "4px 10px", fontSize: 12 }}>
                        <span style={{ color: C.muted }}>{FIELD_LABELS[field] || field}</span>
                        <span style={{ color: C.dim }}>→</span>
                        <span style={{ color: field === "content" ? C.gold : C.text, fontWeight: field === "content" ? 600 : 400 }}>{col}</span>
                      </div>
                    ))}
                </div>
                {up.detectedMap.contentCols?.length > 1 && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontSize: 11, color: C.muted, marginBottom: 6 }}>All feedback columns (concatenated per row):</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {up.detectedMap.contentCols.map((col, i) => (
                        <div key={i} style={{ fontSize: 12, color: C.gold, background: `${C.gold}10`, border: `1px solid ${C.gold}30`, borderRadius: 6, padding: "3px 10px" }}>
                          {i + 1}. {col}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div style={{ display: "flex", gap: 10 }}>
              <button style={btn(C.gold, C.bg)} onClick={() => setView("dashboard")}>View Dashboard →</button>
              <button style={btn(C.s3, C.muted)} onClick={() => setUp(s => ({ ...s, step: "drop" }))}>Upload Another File</button>
            </div>
          </div>
        );
      })()}

      {/* Running total */}
      {records.length > 0 && (
        <div style={{ ...card({ marginTop: 20 }) }}>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>All Imported Data</div>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "center" }}>
            {SOURCES.map(s => {
              const cnt = records.filter(r => r.source === s.id).length;
              if (!cnt) return null;
              return (
                <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 16 }}>{s.icon}</span>
                  <span style={{ fontSize: 22, fontWeight: 600, color: s.color, fontFamily: '"Source Serif 4", Georgia, serif' }}>{cnt}</span>
                  <span style={{ fontSize: 12, color: C.muted }}>{s.label}</span>
                </div>
              );
            })}
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 22, fontWeight: 600, color: C.text, fontFamily: '"Source Serif 4", Georgia, serif' }}>{records.length}</span>
              <span style={{ fontSize: 12, color: C.muted }}>Total Records</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Dashboard ────────────────────────────────────────────────────────────
const DashboardView = ({ stats, filtered, analysis, setView }) => {
  const sentimentData = analysis ? [
    { name: "Positive", value: analysis.overall.positive, color: C.green },
    { name: "Neutral",  value: analysis.overall.neutral,  color: C.gold },
    { name: "Negative", value: analysis.overall.negative, color: C.red },
  ] : [];
  const sourceData = stats.bySource.filter(s => s.count > 0);
  const courseData = useMemo(() => {
    const map = {};
    filtered.forEach(r => { if (r.course_code) map[r.course_code] = (map[r.course_code] || 0) + 1; });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, count]) => ({ name, count }));
  }, [filtered]);

  return (
    <div>
      <Section>Overview</Section>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16, marginBottom: 28 }}>
        {[
          { label: "Total Responses", value: stats.total,       color: C.blue,   icon: "📊", sub: "across all channels" },
          { label: "Unique Students", value: stats.students,    color: C.green,  icon: "🎓", sub: "enrolled learners" },
          { label: "Courses",         value: stats.courses,     color: C.gold,   icon: "📚", sub: "course codes" },
          { label: "Active Sources",  value: sourceData.length, color: C.purple, icon: "🔗", sub: "data channels" },
        ].map(m => (
          <div key={m.label} style={{ ...card({ padding: "20px 22px" }), borderTop: `3px solid ${m.color}`, borderRadius: "2px 2px 12px 12px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
              <span style={{ fontSize: 20 }}>{m.icon}</span>
              <span style={{ fontSize: 11, color: m.color, background: `${m.color}15`, padding: "2px 8px", borderRadius: 20, fontWeight: 600, letterSpacing: "0.03em" }}>{m.sub}</span>
            </div>
            <div style={{ fontSize: 36, fontWeight: 700, color: C.text, fontFamily: '"Source Serif 4", Georgia, serif', lineHeight: 1, letterSpacing: "-0.5px" }}>{m.value}</div>
            <div style={{ fontSize: 12.5, color: C.muted, marginTop: 6, fontWeight: 500 }}>{m.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 20 }}>
        <div style={card()}>
          <Section>Responses by Source</Section>
          {sourceData.length ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={sourceData} barCategoryGap="30%">
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
                <XAxis dataKey="label" tick={{ fill: C.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: C.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip content={<TT />} />
                <Bar dataKey="count" radius={[5, 5, 0, 0]}>{sourceData.map((s, i) => <Cell key={i} fill={s.color} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <div style={{ color: C.muted, fontSize: 13, textAlign: "center", padding: 60 }}>Upload data to see breakdown</div>}
        </div>

        <div style={card()}>
          <Section>Sentiment Distribution</Section>
          {analysis ? (
            <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
              <ResponsiveContainer width={180} height={180}>
                <PieChart>
                  <Pie data={sentimentData} cx="50%" cy="50%" innerRadius={52} outerRadius={82} dataKey="value" strokeWidth={2} stroke={C.s2}>
                    {sentimentData.map((s, i) => <Cell key={i} fill={s.color} />)}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div style={{ flex: 1 }}>
                {sentimentData.map(s => (
                  <div key={s.name} style={{ marginBottom: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                        <div style={{ width: 10, height: 10, borderRadius: "50%", background: s.color }} />{s.name}
                      </div>
                      <span style={{ fontSize: 14, fontWeight: 600, color: s.color, fontFamily: '"Source Serif 4", Georgia, serif' }}>{s.value}%</span>
                    </div>
                    <div style={{ height: 5, background: C.s3, borderRadius: 3 }}>
                      <div style={{ width: `${s.value}%`, height: "100%", background: s.color, borderRadius: 3 }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ textAlign: "center", padding: "40px 20px" }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>✨</div>
              <div style={{ fontSize: 13, color: C.muted, marginBottom: 14 }}>Run AI analysis to see sentiment distribution</div>
              <button style={btn(C.gold, C.bg)} onClick={() => setView("sentiment")}>Go to Sentiment →</button>
            </div>
          )}
        </div>
      </div>

      {courseData.length > 0 && (
        <div style={{ ...card(), marginBottom: 18 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, marginBottom: 14, textTransform: "uppercase", letterSpacing: "0.07em" }}>Responses by Course</div>
          <ResponsiveContainer width="100%" height={Math.max(120, courseData.length * 30)}>
            <BarChart data={courseData} layout="vertical" barCategoryGap="25%">
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} horizontal={false} />
              <XAxis type="number" tick={{ fill: C.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" tick={{ fill: C.text, fontSize: 11 }} axisLine={false} tickLine={false} width={80} />
              <Tooltip content={<TT />} />
              <Bar dataKey="count" fill={C.blue} radius={[0, 5, 5, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {analysis?.root_causes?.length > 0 && (
        <div style={card()}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, textTransform: "uppercase", letterSpacing: "0.07em" }}>Top Issues Identified</div>
            <button onClick={() => setView("rootcause")} style={{ ...btn(C.s3, C.muted), padding: "5px 12px", fontSize: 12 }}>View All →</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
            {analysis.root_causes.slice(0, 6).map((rc, i) => {
              const sc = { critical: C.red, high: C.gold, medium: C.blue, low: C.green }[rc.severity] || C.muted;
              return (
                <div key={i} style={{ background: C.s3, borderRadius: 10, padding: 14, borderLeft: `3px solid ${sc}` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <SeverityBadge s={rc.severity} />
                    <span style={{ fontSize: 11, color: C.muted }}>×{rc.count}</span>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{rc.theme}</div>
                  <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.5 }}>{(rc.description || "").slice(0, 80)}{rc.description?.length > 80 ? "…" : ""}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Sentiment ────────────────────────────────────────────────────────────
const SentimentView = ({ filtered, analysis, loading, progress, error, runAnalysis }) => {
  const analyzed = filtered.filter(r => r._sentiment);
  const sentColors = { positive: C.green, neutral: C.amber, negative: C.red };

  return (
    <div>
      {/* Action bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24, padding: "14px 18px", background: C.s3, borderRadius: 10, border: `1px solid ${C.border}` }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: C.text }}>
            {filtered.length} records ready
          </div>
          {loading && progress.total > 0 && (
            <div style={{ marginTop: 6 }}>
              <div style={{ fontSize: 11.5, color: C.gold, fontWeight: 600, marginBottom: 4 }}>
                {progress.synthesising === 'deepdive' ? '🔍 Enriching findings with deep-dive detail…' : progress.synthesising ? '✨ Synthesising full-dataset insights…' : progress.retrying || `Processing batch ${progress.current} of ${progress.total}…`}
              </div>
              <div style={{ height: 4, background: C.border, borderRadius: 4, overflow: "hidden", width: 200 }}>
                <div style={{ height: "100%", background: C.gold, borderRadius: 4, transition: "width 0.4s ease", width: `${(progress.current / progress.total) * 100}%` }} />
              </div>
            </div>
          )}
          {!loading && analysis && <div style={{ fontSize: 11.5, color: C.muted, marginTop: 2 }}>Last analysed: {analysis.ts} · {analysis.n} records processed</div>}
        </div>
        <button onClick={runAnalysis} disabled={loading || !filtered.length}
          style={loading ? btnGhost({ padding: "9px 20px", opacity: 0.6 }) : analysis ? btnSecondary({ padding: "9px 20px" }) : btnPrimary({ padding: "9px 20px" })}>
          {loading ? progress.synthesising === 'deepdive' ? '🔍 Enriching…' : progress.synthesising ? '✨ Synthesising…' : progress.retrying ? '⏳ Retrying…' : `⏳ Batch ${progress.current}/${progress.total}…` : analysis ? "↺ Re-run Analysis" : "✨ Run Analysis"}
        </button>
      </div>

      {error && <div style={{ background: C.redBg, border: `1px solid ${C.red}40`, borderRadius: 10, padding: "12px 16px", fontSize: 13, color: C.red, marginBottom: 18, display: "flex", gap: 8 }}>
        <span>⚠</span><span>{error}</span>
      </div>}

      {!analysis && !loading && (
        <div style={{ ...card({ textAlign: "center", padding: "64px 40px" }) }}>
          <div style={{ fontSize: 44, marginBottom: 14 }}>🔍</div>
          <div style={{ fontSize: 20, fontWeight: 700, fontFamily: '"Source Serif 4", Georgia, serif', marginBottom: 8, color: C.text }}>No Analysis Yet</div>
          <div style={{ fontSize: 13, color: C.muted, marginBottom: 20, lineHeight: 1.6 }}>Upload feedback data and run analysis to see<br/>sentiment scores across all your records.</div>
          <button onClick={runAnalysis} disabled={!filtered.length} style={btnPrimary()}>
            ✨ Run Analysis Now
          </button>
        </div>
      )}

      {analysis && (<>
        {/* 3 sentiment stat cards */}
        <Section>Sentiment Overview</Section>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16, marginBottom: 24 }}>
          {[
            { label: "Positive",  value: analysis.overall.positive, color: C.green,  bg: C.greenBg,  icon: "😊" },
            { label: "Neutral",   value: analysis.overall.neutral,  color: C.amber,  bg: C.amberBg,  icon: "😐" },
            { label: "Negative",  value: analysis.overall.negative, color: C.red,    bg: C.redBg,    icon: "😞" },
          ].map(s => (
            <div key={s.label} style={{ ...card({ padding: "20px 22px", borderTop: `3px solid ${s.color}`, borderRadius: "2px 2px 12px 12px" }) }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                <span style={{ fontSize: 24 }}>{s.icon}</span>
                <span style={{ fontSize: 12, color: s.color, background: s.bg, padding: "2px 8px", borderRadius: 20, fontWeight: 600 }}>Feedback</span>
              </div>
              <div style={{ fontSize: 40, fontWeight: 700, color: C.text, fontFamily: '"Source Serif 4", Georgia, serif', lineHeight: 1, letterSpacing: "-1px" }}>
                {s.value}<span style={{ fontSize: 22, color: s.color }}>%</span>
              </div>
              <div style={{ fontSize: 12.5, color: C.muted, marginTop: 6, fontWeight: 500 }}>{s.label} Sentiment</div>
              <div style={{ height: 5, background: C.s3, borderRadius: 4, marginTop: 10 }}>
                <div style={{ width: `${s.value}%`, height: "100%", background: s.color, borderRadius: 4, opacity: 0.7 }} />
              </div>
            </div>
          ))}
        </div>

        {/* AI summary */}
        <Section>AI Summary</Section>
        <div style={{ ...card({ marginBottom: 24 }), borderLeft: `3px solid ${C.gold}` }}>
          <div style={{ fontSize: 14.5, lineHeight: 1.85, color: C.text }}>{analysis.summary}</div>
          <div style={{ fontSize: 11.5, color: C.dim, marginTop: 10 }}>Analysed {analysis.n} records · {analysis.ts}</div>
        </div>

        {/* Per-record list */}
        <Section>Per-Record Breakdown ({analyzed.length} analysed)</Section>
        <div style={card({ padding: 0, overflow: "hidden" })}>
          <div style={{ maxHeight: 480, overflowY: "auto" }}>
            {analyzed.length === 0
              ? <div style={{ color: C.muted, fontSize: 13, textAlign: "center", padding: 40 }}>Sentiment data appears here after analysis</div>
              : analyzed.map((r, idx) => {
                  const sc = sentColors[r._sentiment] || C.muted;
                  return (
                    <div key={r.id} style={{ display: "flex", gap: 0, borderBottom: `1px solid ${C.border}`, alignItems: "stretch" }}>
                      {/* Severity stripe */}
                      <div style={{ width: 3, background: sc, flexShrink: 0 }} />
                      <div style={{ flex: 1, padding: "12px 16px", display: "flex", gap: 14, alignItems: "flex-start" }}>
                        <div style={{ flexShrink: 0, paddingTop: 1 }}>
                          <SentimentBadge s={r._sentiment} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", gap: 8, marginBottom: 4, flexWrap: "wrap", alignItems: "center" }}>
                            {r.student_name && <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>👤 {r.student_name}</span>}
                            {r.course_code  && <span style={{ fontSize: 11, color: C.muted }}>· {r.course_code}</span>}
                            {r.date         && <span style={{ fontSize: 11, color: C.dim }}>· {r.date}</span>}
                            {(r._themes||[]).slice(0,3).map((t,ti) => (
                              <span key={ti} style={{ fontSize: 10, background: C.s3, padding: "1px 7px", borderRadius: 20, color: C.muted, border: `1px solid ${C.border}` }}>{t}</span>
                            ))}
                          </div>
                          {r._concern && (
                            <div style={{ fontSize: 12.5, color: C.gold, fontWeight: 600, marginBottom: 5 }}>→ {r._concern}</div>
                          )}
                          <div style={{ fontSize: 13, lineHeight: 1.5, color: C.mid, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                            {(r.content || "").slice(0, 220)}{(r.content||"").length > 220 ? "…" : ""}
                          </div>
                        </div>
                        <div style={{ flexShrink: 0, textAlign: "right", minWidth: 40 }}>
                          <div style={{ fontSize: 18, fontWeight: 700, color: r._score >= 4 ? C.green : r._score <= 2 ? C.red : C.amber, fontFamily: '"Source Serif 4", Georgia, serif', lineHeight: 1 }}>
                            {r._score?.toFixed(1)}
                          </div>
                          <div style={{ fontSize: 10, color: C.dim, marginTop: 2 }}>/ 5</div>
                        </div>
                      </div>
                    </div>
                  );
                })
            }
          </div>
        </div>
      </>)}
    </div>
  );
};

// ─── Root Cause ───────────────────────────────────────────────────────────
const RootCauseView = ({ analysis, loading, progress, error, runAnalysis }) => {
  const sevColors = { critical: C.red, high: C.amber, medium: C.blue, low: C.muted };
  const sevBgs    = { critical: C.redBg, high: C.amberBg, medium: C.blueBg, low: C.s3 };
  const sevData = ["critical","high","medium","low"].map(s => ({
    name: s.charAt(0).toUpperCase()+s.slice(1),
    count: (analysis?.root_causes||[]).filter(r => r.severity===s).length,
    color: sevColors[s],
  }));
  const catData = analysis
    ? Object.entries((analysis.root_causes||[]).reduce((acc,rc) => {
        const k=rc.category||"General"; acc[k]=(acc[k]||0)+rc.count; return acc;
      },{})).sort((a,b)=>b[1]-a[1]).map(([name,value])=>({name,value}))
    : [];
  const maxCat = catData.length ? Math.max(...catData.map(c=>c.value)) : 1;

  return (
    <div>
      {/* Consistent action bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24, padding: "14px 18px", background: C.s3, borderRadius: 10, border: `1px solid ${C.border}` }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: C.text }}>
            {analysis ? `${analysis.root_causes.length} systemic issues identified` : "No root cause data yet"}
          </div>
          {loading && progress.total > 0 && (
            <div style={{ marginTop: 6 }}>
              <div style={{ fontSize: 11.5, color: C.gold, fontWeight: 600, marginBottom: 4 }}>{progress.synthesising === 'deepdive' ? '🔍 Enriching findings with deep-dive detail…' : progress.synthesising ? '✨ Synthesising full-dataset insights…' : progress.retrying || `Processing batch ${progress.current} of ${progress.total}…`}</div>
              <div style={{ height: 4, background: C.border, borderRadius: 4, overflow: "hidden", width: 200 }}>
                <div style={{ height: "100%", background: C.gold, borderRadius: 4, transition: "width 0.4s ease", width: `${(progress.current / progress.total) * 100}%` }} />
              </div>
            </div>
          )}
          {!loading && analysis && <div style={{ fontSize: 11.5, color: C.muted, marginTop: 2 }}>{analysis.n} records analysed · {analysis.ts}</div>}
        </div>
        <button onClick={runAnalysis} disabled={loading}
          style={loading ? btnGhost({ padding: "9px 20px", opacity: 0.6 }) : analysis ? btnSecondary({ padding: "9px 20px" }) : btnPrimary({ padding: "9px 20px" })}>
          {loading ? progress.synthesising === 'deepdive' ? '🔍 Enriching…' : progress.synthesising ? '✨ Synthesising…' : progress.retrying ? '⏳ Retrying…' : `⏳ Batch ${progress.current}/${progress.total}…` : analysis ? "↺ Re-run Analysis" : "✨ Run Analysis"}
        </button>
      </div>

      {error && <div style={{ background: C.redBg, border: `1px solid ${C.red}40`, borderRadius: 10, padding: "12px 16px", fontSize: 13, color: C.red, marginBottom: 18, display: "flex", gap: 8 }}>
        <span>⚠</span><span>{error}</span>
      </div>}

      {!analysis && !loading && (
        <div style={{ ...card({ textAlign: "center", padding: "64px 40px" }) }}>
          <div style={{ fontSize: 44, marginBottom: 14 }}>🌳</div>
          <div style={{ fontSize: 20, fontWeight: 700, fontFamily: '"Source Serif 4", Georgia, serif', marginBottom: 8 }}>No Root Cause Data</div>
          <div style={{ fontSize: 13, color: C.muted, marginBottom: 20, lineHeight: 1.6 }}>Run AI analysis to identify systemic issues,<br/>categories, and severity across your feedback.</div>
          <button onClick={runAnalysis} style={btnPrimary()}>✨ Run Analysis Now</button>
        </div>
      )}

      {analysis?.root_causes && (<>
        {/* Charts row */}
        <Section>Issue Distribution</Section>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 24 }}>
          <div style={card()}>
            <Section>By Severity</Section>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={sevData} barCategoryGap="35%">
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
                <XAxis dataKey="name" tick={{ fill: C.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: C.muted, fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip content={<TT />} />
                <Bar dataKey="count" radius={[5,5,0,0]}>{sevData.map((s,i)=><Cell key={i} fill={s.color}/>)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div style={card()}>
            <Section>By Category</Section>
            <div>
              {catData.map((c,i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: i < catData.length-1 ? `1px solid ${C.border}` : "none" }}>
                  <span style={{ fontSize: 12.5, flex: 1, fontWeight: 500 }}>{c.name}</span>
                  <div style={{ width: 90, height: 6, background: C.s3, borderRadius: 3 }}>
                    <div style={{ width: `${Math.round((c.value/maxCat)*100)}%`, height: "100%", background: C.blue, borderRadius: 3 }} />
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 700, color: C.blue, minWidth: 24, textAlign: "right" }}>{c.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Issue breakdown */}
        <Section>Issue Breakdown ({analysis.root_causes.length} issues)</Section>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
          {[...analysis.root_causes]
            .sort((a,b) => ({critical:0,high:1,medium:2,low:3}[a.severity] - ({critical:0,high:1,medium:2,low:3}[b.severity])))
            .map((rc, i) => {
              const sc = sevColors[rc.severity] || C.muted;
              const sbg = sevBgs[rc.severity] || C.s3;
              return (
                <div key={i} style={{ ...card({ padding: 0, overflow: "hidden" }), display: "flex" }}>
                  <div style={{ width: 4, background: sc, flexShrink: 0 }} />
                  <div style={{ flex: 1, padding: "16px 18px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 14.5, fontWeight: 700, color: C.text }}>{rc.theme}</span>
                        {rc.category && <span style={{ fontSize: 10.5, color: C.muted, background: C.s3, border: `1px solid ${C.border}`, padding: "2px 9px", borderRadius: 20 }}>{rc.category}</span>}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                        <span style={{ fontSize: 11.5, color: C.muted }}>{rc.count} mentions</span>
                        <SeverityBadge s={rc.severity} />
                      </div>
                    </div>
                    <div style={{ fontSize: 13, color: C.mid, lineHeight: 1.7, marginBottom: rc.data_points?.length ? 10 : 0 }}>{rc.description}</div>
                    {rc.data_points?.length > 0 && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        {rc.data_points.slice(0, 2).map((dp, j) => (
                          <div key={j} style={{ fontSize: 11.5, color: C.muted, paddingLeft: 10, borderLeft: `2px solid ${sc}50`, lineHeight: 1.6 }}>{dp}</div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
        </div>

        {/* Recommendations */}
        {analysis.recommendations?.length > 0 && (<>
          <Section>Recommendations</Section>
          <div style={card()}>
            {analysis.recommendations.map((rec, i) => (
              <div key={i} style={{ display: "flex", gap: 14, padding: "12px 0", borderBottom: i < analysis.recommendations.length-1 ? `1px solid ${C.border}` : "none", alignItems: "flex-start" }}>
                <div style={{ width: 24, height: 24, borderRadius: "50%", background: C.goldBg, border: `1px solid ${C.gold}40`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: C.gold, flexShrink: 0, marginTop: 1 }}>{i+1}</div>
                <span style={{ fontSize: 13.5, lineHeight: 1.7, color: C.text }}>{rec}</span>
              </div>
            ))}
          </div>
        </>)}
      </>)}
    </div>
  );
};

// ─── Explorer ─────────────────────────────────────────────────────────────
// Search state lives inside this component — doesn't affect parent re-renders
const ExplorerView = ({ filtered }) => {
  const [search, setSearch] = useState("");
  const searched = useMemo(() =>
    filtered.filter(r =>
      !search || [r.student_name, r.student_email, r.course_code, r.course_title, r.instructor, r.content, r._concern]
        .some(v => (v||"").toLowerCase().includes(search.toLowerCase()))
    ), [filtered, search]);

  return (
    <div>
      {/* Search + count bar */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 20 }}>
        <div style={{ position: "relative", flex: 1, maxWidth: 380 }}>
          <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: C.dim, fontSize: 14, pointerEvents: "none" }}>🔍</span>
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, course, concern, content…"
            style={{ ...inp(), paddingLeft: 36 }}
          />
        </div>
        <span style={{ fontSize: 13, color: C.muted, whiteSpace: "nowrap" }}>
          {searched.length === filtered.length
            ? `${filtered.length} records`
            : `${searched.length} of ${filtered.length} records`}
        </span>
        {search && (
          <button onClick={() => setSearch("")} style={btnGhost({ fontSize: 12, padding: "5px 12px" })}>✕ Clear</button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div style={{ ...card({ textAlign: "center", padding: "64px 40px" }) }}>
          <div style={{ fontSize: 44, marginBottom: 14 }}>📋</div>
          <div style={{ fontSize: 20, fontWeight: 700, fontFamily: '"Source Serif 4", Georgia, serif', marginBottom: 8 }}>No Records Yet</div>
          <div style={{ fontSize: 13, color: C.muted }}>Import data from the Data Upload page to browse records here.</div>
        </div>
      ) : searched.length === 0 ? (
        <div style={{ ...card({ textAlign: "center", padding: "40px" }) }}>
          <div style={{ fontSize: 13, color: C.muted }}>No records match "{search}". Try a different search term.</div>
        </div>
      ) : (
        <div style={{ ...card({ padding: 0, overflow: "hidden" }) }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ background: C.s3, borderBottom: `1.5px solid ${C.border}` }}>
                  {["Source","Student","Course","Date","Score","Concern","Feedback"].map(h => (
                    <th key={h} style={{ padding: "10px 14px", textAlign: "left", color: C.muted, fontWeight: 700, fontSize: 10.5, whiteSpace: "nowrap", textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {searched.slice(0, 100).map((r, rowIdx) => {
                  const src = SOURCES.find(s => s.id === r.source);
                  return (
                    <tr key={r.id} style={{ borderBottom: `1px solid ${C.border}`, background: rowIdx % 2 === 1 ? C.s3 : C.surface }}>
                      <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>
                        <span style={{ fontSize: 15 }}>{src?.icon}</span>
                        <span style={{ fontSize: 10, color: src?.color, marginLeft: 5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>{src?.id}</span>
                      </td>
                      <td style={{ padding: "10px 14px", maxWidth: 160 }}>
                        <div style={{ fontWeight: 600, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.student_name || <span style={{color:C.dim}}>—</span>}</div>
                        {r.student_email && <div style={{ fontSize: 10.5, color: C.muted, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.student_email}</div>}
                      </td>
                      <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>
                        <div style={{ fontWeight: 600 }}>{r.course_code || <span style={{color:C.dim}}>—</span>}</div>
                        {r.course_title && <div style={{ fontSize: 10.5, color: C.muted, marginTop: 1 }}>{r.course_title.slice(0,30)}</div>}
                      </td>
                      <td style={{ padding: "10px 14px", whiteSpace: "nowrap", color: C.muted }}>{r.date || <span style={{color:C.dim}}>—</span>}</td>
                      <td style={{ padding: "10px 14px", textAlign: "center" }}>
                        {r._score ? (
                          <div style={{ display: "inline-flex", alignItems: "baseline", gap: 1 }}>
                            <span style={{ fontSize: 15, fontWeight: 700, color: r._score >= 4 ? C.green : r._score <= 2 ? C.red : C.amber, fontFamily: '"Source Serif 4",serif' }}>{r._score.toFixed(1)}</span>
                            <span style={{ fontSize: 10, color: C.dim }}>/5</span>
                          </div>
                        ) : r._sentiment ? <SentimentBadge s={r._sentiment} /> : <span style={{color:C.dim}}>—</span>}
                      </td>
                      <td style={{ padding: "10px 14px", maxWidth: 200 }}>
                        {r._concern
                          ? <span style={{ fontSize: 12, color: C.gold, fontWeight: 600 }}>{r._concern}</span>
                          : <span style={{color:C.dim}}>—</span>}
                      </td>
                      <td style={{ padding: "10px 14px", maxWidth: 300 }}>
                        <div style={{ color: C.mid, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {(r.content || "").slice(0, 120)}{(r.content||"").length > 120 ? "…" : ""}
                        </div>
                        {(r._themes||[]).length > 0 && (
                          <div style={{ display: "flex", gap: 4, marginTop: 4, flexWrap: "wrap" }}>
                            {r._themes.slice(0,3).map((t,ti) => <span key={ti} style={{ fontSize: 9.5, background: C.s3, border: `1px solid ${C.border}`, padding: "1px 6px", borderRadius: 20, color: C.muted }}>{t}</span>)}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {searched.length > 100 && (
            <div style={{ padding: "10px 16px", fontSize: 12, color: C.muted, borderTop: `1px solid ${C.border}`, background: C.s3, textAlign: "center" }}>
              Showing first 100 of {searched.length} records
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ─── Findings ─────────────────────────────────────────────────────────────
const FindingsView = ({ analysis, filtered, loading, progress, error, runAnalysis }) => {
  const [expanded, setExpanded] = useState({});
  const toggle = (i) => setExpanded(prev => ({ ...prev, [i]: !prev[i] }));

  const sevColors = { critical: C.red, high: C.amber, medium: C.blue, low: C.muted };
  const findings = analysis?.findings || [];
  const convergence = analysis?.convergence || [];
  const likertAverages = analysis?.likertAverages || [];
  const barColor = (v) => v >= 4.0 ? C.green : v >= 3.5 ? C.blue : v >= 3.0 ? C.amber : C.red;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 20, padding: "14px 18px", background: C.s3, borderRadius: 10, border: `1px solid ${C.border}` }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, color: C.text, fontWeight: 500 }}>
            {filtered.length} records · {analysis ? `${analysis.n} analysed · ${analysis.ts}` : "Run analysis to generate findings"}
          </div>
          {loading && progress.total > 0 && (
            <div style={{ marginTop: 6 }}>
              <div style={{ fontSize: 11.5, color: C.gold, fontWeight: 600, marginBottom: 4 }}>{progress.synthesising === 'deepdive' ? '🔍 Enriching findings with deep-dive detail…' : progress.synthesising ? '✨ Synthesising full-dataset insights…' : progress.retrying || `Processing batch ${progress.current} of ${progress.total}…`}</div>
              <div style={{ height: 4, background: C.border, borderRadius: 4, overflow: "hidden", width: 200 }}>
                <div style={{ height: "100%", background: C.gold, borderRadius: 4, transition: "width 0.4s ease", width: `${(progress.current / progress.total) * 100}%` }} />
              </div>
            </div>
          )}
        </div>
        <button onClick={runAnalysis} disabled={loading || !filtered.length}
          style={{ ...btn(loading ? C.s3 : analysis ? C.s3 : C.gold, loading ? C.muted : analysis ? C.mid : "#fff", { border: `1px solid ${analysis ? C.border : "transparent"}`, fontSize: 12, padding: "7px 16px", flexShrink: 0 }) }}>
          {loading ? progress.synthesising === 'deepdive' ? '🔍 Enriching…' : progress.synthesising ? '✨ Synthesising…' : progress.retrying ? '⏳ Retrying…' : `⏳ Batch ${progress.current}/${progress.total}…` : analysis ? "↺ Re-run" : "✨ Run Analysis"}
        </button>
      </div>
      {error && <div style={{ background: C.redBg, border: `1px solid ${C.red}40`, borderRadius: 10, padding: "12px 16px", fontSize: 13, color: C.red, marginBottom: 16 }}>{error}</div>}

      {!analysis && !loading && (
        <div style={{ ...card({ textAlign: "center", padding: "60px 40px" }) }}>
          <div style={{ fontSize: 40, marginBottom: 14 }}>🔭</div>
          <div style={{ fontSize: 18, fontWeight: 700, fontFamily: '"Source Serif 4", Georgia, serif', marginBottom: 8 }}>No Findings Yet</div>
          <div style={{ fontSize: 13, color: C.muted }}>Run analysis to generate key findings with supporting data, timelines, and actionable considerations</div>
        </div>
      )}

      {analysis && (<>

        {/* ── Cross-channel convergence table ── */}
        {convergence.length > 0 && (
          <div style={{ ...card({ marginBottom: 20 }) }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>Cross-Channel Theme Convergence</div>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 14 }}>Themes appearing across multiple channels carry stronger signal.</div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: `1.5px solid ${C.border}` }}>
                    {["Theme", "Tickets", "Chat", "Survey", "Severity", "Mentions"].map(h => (
                      <th key={h} style={{ padding: "8px 10px", textAlign: "left", color: C.muted, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {convergence.filter(rc => rc.channels > 0).map((rc, i) => {
                    const sc = sevColors[rc.severity] || C.muted;
                    const Tag = ({ n, color }) => n > 0
                      ? <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 6, fontSize: 11, fontWeight: 600, color, background: `${color}18` }}>{n}</span>
                      : <span style={{ color: C.dim, fontSize: 11 }}>—</span>;
                    return (
                      <tr key={i} style={{ borderBottom: `1px solid ${C.border}33` }}>
                        <td style={{ padding: "9px 10px", fontWeight: 600, color: C.text, maxWidth: 260 }}>{rc.theme}</td>
                        <td style={{ padding: "9px 10px" }}><Tag n={rc.inTicket} color={C.amber} /></td>
                        <td style={{ padding: "9px 10px" }}><Tag n={rc.inChat} color={C.purple} /></td>
                        <td style={{ padding: "9px 10px" }}><Tag n={rc.inSurvey} color={C.teal} /></td>
                        <td style={{ padding: "9px 10px" }}><SeverityBadge s={rc.severity} /></td>
                        <td style={{ padding: "9px 10px", fontWeight: 700, color: C.text }}>{rc.count}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 12, padding: "10px 14px", background: C.s3, borderRadius: 8, fontSize: 11.5, color: C.muted, lineHeight: 1.6 }}>
              <strong style={{ color: C.text }}>Note on channel bias:</strong> Tickets and chats are help-seeking channels — they skew negative by nature. Survey responses provide a more balanced view of overall satisfaction.
            </div>
          </div>
        )}

        {/* ── Likert averages from surveys ── */}
        {likertAverages.length > 0 && (
          <div style={{ ...card({ marginBottom: 20 }) }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 14 }}>Survey Rating Averages (Likert Scale 1–5)</div>
            {likertAverages.slice(0, 8).map((d, i) => {
              const pct = ((d.avg - 1) / 4) * 100;
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: i < Math.min(likertAverages.length, 8) - 1 ? 10 : 0 }}>
                  <div style={{ width: 220, fontSize: 12, fontWeight: 500, color: C.text, textAlign: "right", flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={d.dim}>{d.dim}</div>
                  <div style={{ flex: 1, height: 18, background: C.s3, borderRadius: 4, overflow: "hidden" }}>
                    <div style={{ width: `${pct}%`, height: "100%", background: barColor(d.avg), borderRadius: 4, opacity: 0.75, transition: "width 0.6s ease" }} />
                  </div>
                  <div style={{ width: 36, fontSize: 14, fontWeight: 700, color: barColor(d.avg), textAlign: "right" }}>{d.avg}</div>
                </div>
              );
            })}
            {likertAverages.length > 0 && (() => {
              const best = likertAverages[0];
              const worst = likertAverages[likertAverages.length - 1];
              return (
                <div style={{ marginTop: 12, padding: "10px 14px", background: C.s3, borderRadius: 8, fontSize: 11.5, color: C.muted }}>
                  <strong style={{ color: C.green }}>Highest rated:</strong> {best.dim} ({best.avg}) &nbsp;·&nbsp;
                  <strong style={{ color: C.red }}>Lowest rated:</strong> {worst.dim} ({worst.avg})
                </div>
              );
            })()}
          </div>
        )}

        {/* ── Key findings with expandable deep-dives ── */}
        {findings.length > 0 && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 16 }}>Key Findings — {findings.length} insights</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {findings.map((f, i) => {
                const isOpen = expanded[i];
                return (
                  <div key={i} style={{ ...card({ padding: 0, overflow: "hidden" }) }}>
                    {/* Header */}
                    <div style={{ padding: "14px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 15, fontWeight: 700, color: C.mid, flexShrink: 0 }}>#{i + 1}</span>
                        <span style={{ fontWeight: 700, fontSize: 14, color: C.text }}>{f.title}</span>
                      </div>
                      {f.channels && (
                        <span style={{ fontSize: 11, color: C.blue, background: C.blueBg, padding: "2px 10px", borderRadius: 20, whiteSpace: "nowrap", flexShrink: 0 }}>{f.channels}</span>
                      )}
                    </div>

                    {/* Body */}
                    <div style={{ padding: "16px 20px" }}>
                      <div style={{ fontSize: 13, color: C.mid, lineHeight: 1.75, marginBottom: 16 }}>{f.detail}</div>

                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
                        {/* Data points */}
                        <div style={{ background: C.s3, borderRadius: 8, padding: "12px 16px" }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>Supporting Data</div>
                          {(f.data_points || []).map((dp, j) => (
                            <div key={j} style={{ fontSize: 12, color: C.mid, lineHeight: 1.6, marginBottom: j < (f.data_points?.length || 0) - 1 ? 5 : 0, paddingLeft: 10, borderLeft: `2px solid ${C.border}` }}>{dp}</div>
                          ))}
                        </div>
                        {/* Considerations */}
                        <div style={{ background: `${C.gold}06`, border: `1px solid ${C.gold}20`, borderRadius: 8, padding: "12px 16px" }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: C.gold, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>Considerations</div>
                          {(f.considerations || []).map((c, j) => (
                            <div key={j} style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: j < (f.considerations?.length || 0) - 1 ? 6 : 0 }}>
                              <div style={{ width: 6, height: 6, borderRadius: "50%", background: C.gold, flexShrink: 0, marginTop: 5 }} />
                              <span style={{ fontSize: 12, color: C.mid, lineHeight: 1.5 }}>{c}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Toggle deep dive */}
                      <button onClick={() => toggle(i)} style={{
                        padding: "8px 18px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit",
                        border: `1px solid ${isOpen ? C.gold : C.border}`,
                        background: isOpen ? C.goldBg : "transparent",
                        color: isOpen ? C.gold : C.mid, fontSize: 12.5, fontWeight: 600,
                        display: "flex", alignItems: "center", gap: 8, transition: "all 0.2s",
                      }}>
                        <svg width="12" height="12" viewBox="0 0 12 12" style={{ transform: isOpen ? "rotate(90deg)" : "none", transition: "transform 0.2s" }}>
                          <path d="M4 2 L8 6 L4 10" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
                        </svg>
                        {isOpen ? "Hide Detail" : "Dig Deeper"}
                      </button>

                      {/* Expanded detail */}
                      {isOpen && (
                        <div style={{ marginTop: 16, borderTop: `1px solid ${C.border}`, paddingTop: 16 }}>
                          {f.deepDive ? (<>
                            {/* Impact Analysis */}
                            {f.deepDive.impactAnalysis && (
                              <div style={{ background: `${C.blue}06`, border: `1px solid ${C.blue}18`, borderRadius: 10, padding: "14px 18px", marginBottom: 14 }}>
                                <div style={{ fontSize: 10, fontWeight: 700, color: C.blue, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Impact Analysis</div>
                                <div style={{ fontSize: 12.5, color: C.mid, lineHeight: 1.75 }}>{f.deepDive.impactAnalysis}</div>
                              </div>
                            )}
                            {/* Timeline */}
                            {(f.deepDive.timeline||[]).length > 0 && (
                              <div style={{ marginBottom: 14 }}>
                                <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>Timeline of Events</div>
                                <div style={{ position: "relative", paddingLeft: 20 }}>
                                  <div style={{ position: "absolute", left: 5, top: 4, bottom: 4, width: 2, background: C.border, borderRadius: 1 }} />
                                  {f.deepDive.timeline.map((t, j) => (
                                    <div key={j} style={{ position: "relative", marginBottom: j < f.deepDive.timeline.length - 1 ? 12 : 0 }}>
                                      <div style={{ position: "absolute", left: -18, top: 4, width: 8, height: 8, borderRadius: "50%", background: C.gold, border: `2px solid ${C.bg}` }} />
                                      <div style={{ fontSize: 11, fontWeight: 700, color: C.gold, marginBottom: 2 }}>{t.date}</div>
                                      <div style={{ fontSize: 12, color: C.mid, lineHeight: 1.6 }}>{t.event}</div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            {/* Affected Students */}
                            {(f.deepDive.affectedStudents||[]).length > 0 && (
                              <div style={{ marginBottom: 14 }}>
                                <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>Affected Students</div>
                                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                  {f.deepDive.affectedStudents.map((s, j) => (
                                    <div key={j} style={{ background: C.s3, borderRadius: 8, padding: "10px 14px", display: "grid", gridTemplateColumns: "160px 130px 1fr", gap: 10, alignItems: "center" }}>
                                      <span style={{ fontWeight: 600, fontSize: 12.5, color: C.text }}>{s.name}</span>
                                      <span style={{ fontSize: 10.5, color: C.purple, background: C.purpleBg, padding: "2px 8px", borderRadius: 20, textAlign: "center" }}>{s.touchpoints}</span>
                                      <span style={{ fontSize: 11.5, color: C.mid, lineHeight: 1.5 }}>{s.detail}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            {/* Response Analysis */}
                            {f.deepDive.responseAnalysis && (
                              <div style={{ background: C.s3, borderRadius: 10, padding: "14px 18px" }}>
                                <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Response &amp; Resolution</div>
                                <div style={{ fontSize: 12.5, color: C.mid, lineHeight: 1.75 }}>{f.deepDive.responseAnalysis}</div>
                              </div>
                            )}
                          </>) : (
                            <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.8 }}>
                              Re-run analysis to generate deep-dive details for this finding.
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {findings.length === 0 && (
          <div style={{ ...card({ textAlign: "center", padding: "40px 20px" }) }}>
            <div style={{ fontSize: 13, color: C.muted }}>No findings were returned. Try re-running analysis with more records.</div>
          </div>
        )}

      </>)}
    </div>
  );
};

// ─── App — root component ─────────────────────────────────────────────────
// API key is handled automatically by the Claude.ai artifact platform.
export default function App() {
  const [view,        setView]        = useState("upload");
  const [records,     setRecords]     = useState([]);
  const [up,          setUp]          = useState({ step: "drop", source: "survey", rawData: [], headers: [], map: {}, dups: 0, added: 0 });
  const [filters,     setFilters]     = useState({ sources: [], courseCode: "", courseTitle: "", instructors: "", facilitators: "", students: "", from: "", to: "" });
  const [showFilters, setShowFilters] = useState(false);
  const [analysis,    setAnalysis]    = useState(null);
  const [loading,     setLoading]     = useState(false);
  const [progress,    setProgress]    = useState({ current: 0, total: 0 });
  const [error,       setError]       = useState("");
  const [showSave,    setShowSave]    = useState(false);
  const [showClear,   setShowClear]   = useState(false);
  const [showSaved,   setShowSaved]   = useState(false);

  const clearAll = () => {
    setRecords([]);
    setAnalysis(null);
    setError("");
    setUp({ step: "drop", source: "survey", rawData: [], headers: [], map: {}, dups: 0, added: 0 });
    setFilters({ sources: [], courseCode: "", courseTitle: "", instructors: "", facilitators: "", students: "", from: "", to: "" });
    setShowClear(false);
    setView("upload");
  };

  const loadSaved = (payload) => {
    // Restore all analysis data from a saved entry (records are not saved, only analysis)
    setAnalysis({
      overall:         payload.overall,
      root_causes:     payload.root_causes     || [],
      findings:        payload.findings        || [],
      convergence:     payload.convergence     || [],
      likertAverages:  payload.likertAverages  || [],
      summary:         payload.summary         || "",
      recommendations: payload.recommendations || [],
      records:         [],
      n:               payload.n,
      ts:              new Date(payload.ts).toLocaleString(),
      records:         [],
    });
    if (payload.filters) {
      setFilters(f => ({
        ...f,
        courseCode:  payload.filters.courseCode  || f.courseCode,
        courseTitle: payload.filters.courseTitle || f.courseTitle,
        from:        payload.filters.from        || f.from,
        to:          payload.filters.to          || f.to,
      }));
    }
    setView("dashboard");
  };

  // Display-time filter: ONLY the source/channel toggle applies here.
  // All other filters (course, date, instructor, facilitator, students) are
  // import-time only — they controlled what got ingested, not what is displayed.
  const filtered = useMemo(() =>
    filters.sources.length
      ? records.filter(r => filters.sources.includes(r.source))
      : records
  , [records, filters.sources]);

  const stats = useMemo(() => ({
    total:    filtered.length,
    students: new Set(filtered.map(r=>r.student_email||r.student_name).filter(Boolean)).size,
    courses:  new Set(filtered.map(r=>r.course_code).filter(Boolean)).size,
    bySource: SOURCES.map(s=>({ ...s, count: filtered.filter(r=>r.source===s.id).length })),
  }), [filtered]);

  const activeFiltersCount = [
    filters.sources.length > 0, filters.courseCode, filters.courseTitle,
    filters.instructors, filters.facilitators, filters.students, filters.from, filters.to,
  ].filter(Boolean).length;

  const filteredRef = useRef(filtered);
  filteredRef.current = filtered;

  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  // Domain knowledge baked into every API call so the model classifies
  // consistently using the known themes from educational feedback research.
  // Course and staff details are read from filtersRef inside runAnalysis so
  // the callback never captures a stale snapshot (useCallback has empty deps).
  // (courseLabel / staffLabel / DOMAIN_CONTEXT are now computed fresh inside runAnalysis
  //  via filtersRef so the useCallback with empty deps never sees stale filter values)

  const runAnalysis = useCallback(async () => {
    const currentFiltered = filteredRef.current;
    const currentFilters  = filtersRef.current;  // always-fresh filters

    // Build domain context from live filters (avoids stale closure)
    const courseLabel = [currentFilters.courseCode, currentFilters.courseTitle].filter(Boolean).join(" / ") || "online higher-education course";
    const staffLabel  = [currentFilters.instructors && `Instructor(s): ${currentFilters.instructors.replace(/\n/g,", ")}`,
                         currentFilters.facilitators && `Facilitator(s): ${currentFilters.facilitators.replace(/\n/g,", ")}`].filter(Boolean).join(" | ");
    const DOMAIN_CONTEXT = `
COURSE CONTEXT: "${courseLabel}"${staffLabel ? `\n${staffLabel}` : ""}

KNOWN RECURRING THEMES (weight these heavily when present):
1. Tooling & platform issues — software instability, credit/quota exhaustion, environment setup failures (critical/high)
2. Content access problems — recordings not posted, materials hard to locate, broken links (medium)
3. Assignment instruction clarity — mismatched instructions, unclear submission steps, wrong resources linked (high/critical)
4. Live session access failures — scheduling conflicts, join failures, host unavailability (critical)
5. Onboarding difficulties — initial setup complexity, account creation, first-week access issues (high)
6. Instructor/facilitator responsiveness — unanswered messages, long response delays (high)
7. Grading visibility — grades not showing, feedback inaccessible, incorrect scores displayed (high)
8. Deadline flexibility — late submission requests, extension queries (medium)
9. Prerequisites / accessibility — course assumes prior knowledge not stated upfront (high)
10. Tool alternatives — requests to use different platforms or software (medium)

CHANNEL BIAS NOTE: Support tickets and chats are help-seeking channels — they skew negative by nature. Survey responses give a more balanced view. Adjust sentiment accordingly: a chat message that is just a factual question is neutral, not negative.

SENTIMENT SCALE:
- positive: student is satisfied, complimenting course/staff, or issue was fully resolved
- neutral: informational query, routine clarification, mixed ratings, or mild concern
- negative: unresolved problem, strong frustration, critical access failure, strongly disagree ratings

CATEGORIES for root causes: "Tooling & Platform", "Instruction & Content", "Communication & Support", "Assessment & Grading", "Scheduling & Access", "Onboarding & Setup", "Course Design"
`.trim();

    if (!currentFiltered.length) {
      setError("No records to analyse. Import data first, or clear any filters that are hiding records.");
      return;
    }
    setLoading(true); setError("");

    // Surveys contain multiple question:answer pairs concatenated, so they need much
    // more headroom than a single chat message or ticket. 220 chars cuts surveys
    // mid-question, before any qualitative responses are visible to the model.
    // Limits chosen so a 25-record survey batch stays well under ~6k input tokens.
    const SOURCE_LIMITS = { survey: 700, transcript: 400, ticket: 300, lms: 300 };
    const trimContent = (text, source) => {
      const max = SOURCE_LIMITS[source] || 300;
      if (!text) return "";
      const lines = text.split("\n").filter(l => {
        const val = l.includes(":") ? l.split(":").slice(1).join(":").trim() : l.trim();
        return val.length > 2 && !/^\d{4}-\d{2}-\d{2}T/.test(val);
      });
      return lines.join("\n").slice(0, max);
    };

    // Batch size is source-aware: surveys have 700-char records so we use smaller
    // batches to keep input tokens safe. Mixed batches use the default of 20.
    const BATCH_SIZES = { survey: 15, transcript: 20, ticket: 25, lms: 25 };
    const dominantSource = (() => {
      const counts = {};
      currentFiltered.forEach(r => { counts[r.source] = (counts[r.source] || 0) + 1; });
      return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || "lms";
    })();
    const BATCH = BATCH_SIZES[dominantSource] || 20;
    const batches = [];
    for (let i = 0; i < currentFiltered.length; i += BATCH) {
      batches.push(currentFiltered.slice(i, i + BATCH));
    }

    const SYSTEM = `You are an expert educational feedback analyst.
${DOMAIN_CONTEXT}

Return ONLY a single valid JSON object — no markdown fences, no commentary.
Required structure:
{"overall":{"positive":0,"neutral":0,"negative":0},"records":[{"i":1,"sentiment":"positive","score":3.5,"concern":"One-line actionable label","themes":["theme"]}],"root_causes":[{"theme":"...","count":1,"severity":"critical|high|medium|low","description":"...","category":"...","data_points":["specific evidence quote"],"affected_students":["Name"]}],"findings":[{"title":"...","channels":"e.g. 3 tickets + 2 chats","detail":"2-3 sentence analysis","data_points":["evidence"],"considerations":["actionable suggestion"],"deepDive":{"impactAnalysis":"2-3 sentences on student impact","affectedStudents":[{"name":"Student Name","touchpoints":"e.g. 2 tickets + 1 chat","detail":"what they experienced"}],"responseAnalysis":"How was this handled / resolved or not","timeline":[{"date":"e.g. Feb 4","event":"What happened"}]}}],"summary":"...","recommendations":["..."]}

Rules:
- overall positive+neutral+negative must equal exactly 100
- score is 1–5 (1=very negative, 3=neutral, 5=very positive)
- concern is a short actionable label per record e.g. "Grade not visible" or "Cannot join Zoom class"
- one "records" entry per input record; "i" matches the [N] bracket
- root_causes: systemic issues only; include 2-3 specific data_points quoting or referencing records; list affected student names where visible
- findings: 3-5 cross-cutting insights spanning multiple records; each must have a deepDive with impactAnalysis, affectedStudents (name each student), responseAnalysis, and a timeline of key events
- channel bias: tickets and chats are help-seeking and skew negative; note this in summary
- summary: max 80 words
- recommendations: 3-5 actionable items`;

    try {
      // Run all batches, collecting per-record sentiments and per-batch root causes
      const allSentMap = {};
      const allRootCauses = [];
      const allBatchSummaries = [];
      const overallTotals = { positive: 0, neutral: 0, negative: 0 };
      let totalRecordsAnalysed = 0;
      let lastSummary = "";
      let lastRecs = [];

      // Retry wrapper — handles transient gateway errors (502, 503, 529) and
      // rate limits (429) with exponential backoff. 3 attempts per batch.
      const fetchWithRetry = async (body, batchNum) => {
        const RETRYABLE = new Set([429, 500, 502, 503, 529]);
        const delays = [2000, 5000, 12000]; // ms to wait before attempt 2, 3, 4
        let lastErr;
        for (let attempt = 0; attempt <= delays.length; attempt++) {
          if (attempt > 0) {
            const wait = delays[attempt - 1];
            setProgress(p => ({ ...p, retrying: `Batch ${batchNum} — retrying in ${wait / 1000}s (attempt ${attempt + 1}/4)…` }));
            await new Promise(r => setTimeout(r, wait));
            setProgress(p => ({ ...p, retrying: null }));
          }
          const res = await fetch(ANTHROPIC_URL, {
            method: "POST", headers: apiHeaders(),
            body: JSON.stringify(body),
          });
          if (res.ok) return res;
          const text = await res.text().catch(() => "");
          if (RETRYABLE.has(res.status) && attempt < delays.length) {
            lastErr = `${res.status}: ${text.slice(0, 80)}`;
            continue; // will retry
          }
          throw new Error(`Batch ${batchNum} API error ${res.status}: ${text.slice(0, 120)}`);
        }
        throw new Error(`Batch ${batchNum} failed after ${delays.length + 1} attempts. Last error: ${lastErr}`);
      };

      setProgress({ current: 0, total: batches.length, retrying: null });

      for (let b = 0; b < batches.length; b++) {
        setProgress(p => ({ ...p, current: b + 1, retrying: null }));
        const batch = batches[b];
        const text = batch.map((r, i) =>
          `[${i + 1}] src:${r.source} student:${r.student_name || "anon"}\n${trimContent(r.content, r.source)}`
        ).join("\n---\n");

        const res = await fetchWithRetry({
          model: "claude-sonnet-4-6",
          max_tokens: 8000,
          system: SYSTEM,
          messages: [{ role: "user", content: `Batch ${b + 1} of ${batches.length} — analyse these ${batch.length} feedback records:\n\n${text}` }]
        }, b + 1);

        const d = await res.json();
        if (d.error) throw new Error(`Batch ${b + 1} model error: ${JSON.stringify(d.error).slice(0, 120)}`);
        if (d.stop_reason === "max_tokens") throw new Error(`Batch ${b + 1} response was cut off. Retry — if it persists, reduce the record count.`);

        const raw = (d.content || []).map(b => b.text || "").join("").trim();
        const jsonStr = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();

        let parsed;
        try { parsed = JSON.parse(jsonStr); }
        catch { throw new Error(`Batch ${b + 1}: could not parse response. First 200 chars: ${raw.slice(0, 200)}`); }

        if (!parsed?.overall || !Array.isArray(parsed?.records)) {
          throw new Error(`Batch ${b + 1} response structure invalid. Please retry.`);
        }

        // Accumulate weighted sentiment totals
        overallTotals.positive += (parsed.overall.positive || 0) * batch.length;
        overallTotals.neutral  += (parsed.overall.neutral  || 0) * batch.length;
        overallTotals.negative += (parsed.overall.negative || 0) * batch.length;
        totalRecordsAnalysed   += batch.length;

        // Map sentiments back to record IDs
        (parsed.records || []).forEach(pr => {
          const rec = batch[pr.i - 1];
          if (rec) allSentMap[rec.id] = {
            sentiment: pr.sentiment,
            score: Math.min(5, Math.max(1, pr.score || 3)), // ensure 1-5 range
            concern: pr.concern || "",
            themes: pr.themes || [],
          };
        });

        // Accumulate root causes (merge same theme later)
        (parsed.root_causes || []).forEach(rc => allRootCauses.push(rc));

        // Collect per-batch summaries for synthesis pass — don't use findings yet
        if (parsed.summary) allBatchSummaries.push(`Batch ${b+1} (${batch.length} records): ${parsed.summary}`);
      }

      // Compute weighted-average overall percentages
      const overall = {
        positive: Math.round(overallTotals.positive / totalRecordsAnalysed),
        neutral:  Math.round(overallTotals.neutral  / totalRecordsAnalysed),
        negative: 0,
      };
      overall.negative = 100 - overall.positive - overall.neutral;

      // Merge root causes by theme (case-insensitive), summing counts
      const rcMap = {};
      allRootCauses.forEach(rc => {
        const key = rc.theme.toLowerCase().trim();
        if (rcMap[key]) {
          rcMap[key].count += (rc.count || 1);
          // merge data_points and affected_students from duplicate themes
          rcMap[key].data_points = [...new Set([...(rcMap[key].data_points||[]), ...(rc.data_points||[])])].slice(0, 4);
          rcMap[key].affected_students = [...new Set([...(rcMap[key].affected_students||[]), ...(rc.affected_students||[])])].slice(0, 8);
        } else {
          rcMap[key] = { ...rc, count: rc.count || 1 };
        }
      });
      const mergedRootCauses = Object.values(rcMap).sort((a, b) => {
        const sevOrder = { critical: 0, high: 1, medium: 2, low: 3 };
        return (sevOrder[a.severity] ?? 4) - (sevOrder[b.severity] ?? 4) || b.count - a.count;
      });

      // Stamp sentiments onto records in state
      setRecords(prev => prev.map(r =>
        allSentMap[r.id]
          ? { ...r, _sentiment: allSentMap[r.id].sentiment, _score: allSentMap[r.id].score, _concern: allSentMap[r.id].concern, _themes: allSentMap[r.id].themes }
          : r
      ));

      // ── Client-side metrics (no extra API call needed) ──────────────────

      // Likert scale: extract numeric ratings from survey content columns
      const LIKERT = { "strongly agree": 5, "agree": 4, "neutral": 3, "neutral/agree": 3.5, "disagree": 2, "strongly disagree": 1 };
      const surveyRecords = currentFiltered.filter(r => r.source === "survey");
      const likertDims = {};
      surveyRecords.forEach(r => {
        (r.content || "").split("\n").forEach(line => {
          const sep = line.indexOf(":");
          if (sep < 0) return;
          const key = line.slice(0, sep).trim();
          const val = line.slice(sep + 1).trim().toLowerCase();
          const score = LIKERT[val];
          if (score) {
            if (!likertDims[key]) likertDims[key] = [];
            likertDims[key].push(score);
          }
        });
      });
      const likertAverages = Object.entries(likertDims)
        .map(([dim, vals]) => ({ dim, avg: +(vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(1), n: vals.length }))
        .filter(d => d.n >= 2)
        .sort((a, b) => b.avg - a.avg);

      // Channel convergence counts — uses fully merged sentiment map
      const convergence = mergedRootCauses.map(rc => {
        const inTicket = currentFiltered.filter(r => r.source === "ticket" && allSentMap[r.id]?.themes?.some(t => t.toLowerCase().includes(rc.theme.toLowerCase().slice(0,8)))).length;
        const inChat   = currentFiltered.filter(r => r.source === "lms"    && allSentMap[r.id]?.themes?.some(t => t.toLowerCase().includes(rc.theme.toLowerCase().slice(0,8)))).length;
        const inSurvey = currentFiltered.filter(r => r.source === "survey" && allSentMap[r.id]?.themes?.some(t => t.toLowerCase().includes(rc.theme.toLowerCase().slice(0,8)))).length;
        return { ...rc, inTicket, inChat, inSurvey, channels: [inTicket && "Tickets", inChat && "Chat", inSurvey && "Survey"].filter(Boolean).length };
      });

      // ── Synthesis pass — one final API call that sees the FULL picture ──
      // Batch passes only classified records. This pass gets merged root causes
      // (counts across all N records), sentiment totals, likert averages, and
      // per-batch summaries so findings/summary/recommendations reflect the
      // entire dataset — not just the last or largest batch.
      setProgress({ current: batches.length, total: batches.length, retrying: null, synthesising: true });

      const sourceCounts = SOURCES.map(s => ({ label: s.label, n: currentFiltered.filter(r => r.source === s.id).length })).filter(x => x.n > 0);
      const likertSummary = likertAverages.slice(0, 8).map(d => `${d.dim}: ${d.avg}/5 (n=${d.n})`).join("; ");
      const convergenceSummary = convergence.slice(0, 8).map(rc => `"${rc.theme}" — tickets:${rc.inTicket} chat:${rc.inChat} survey:${rc.inSurvey} severity:${rc.severity}`).join("\n");

      const synthPrompt = `You are synthesising a complete cross-dataset analysis.

DATASET: ${totalRecordsAnalysed} records total — ${sourceCounts.map(s=>`${s.n} ${s.label}`).join(", ")}.
SENTIMENT (weighted avg): ${overall.positive}% positive, ${overall.neutral}% neutral, ${overall.negative}% negative.

MERGED ROOT CAUSES (across all records):
${mergedRootCauses.slice(0, 12).map((rc, i) => `${i+1}. [${rc.severity}] ${rc.theme} — count:${rc.count}, category:${rc.category}\n   Evidence: ${(rc.data_points||[]).slice(0,2).join(" | ")}\n   Students: ${(rc.affected_students||[]).slice(0,4).join(", ")}`).join("\n")}

CROSS-CHANNEL CONVERGENCE:
${convergenceSummary || "No convergence data"}

SURVEY RATINGS (Likert averages):
${likertSummary || "No survey ratings"}

PER-BATCH SUMMARIES:
${allBatchSummaries.join("\n")}

${DOMAIN_CONTEXT}

Return ONLY a valid JSON object — no markdown, no commentary:
{"findings":[{"title":"...","channels":"e.g. 47 tickets + 23 chats","detail":"2-3 sentence insight with actual total counts","data_points":["cross-dataset evidence with counts"],"considerations":["actionable suggestion"]}],"summary":"Max 80 words covering all ${totalRecordsAnalysed} records.","recommendations":["3-5 actionable items"]}

Rules:
- exactly 4-5 findings from the FULL dataset — cite actual counts, not batch-relative ones
- summary must mention sentiment split and top concern across all ${totalRecordsAnalysed} records
- recommendations grounded in merged root causes above`;

      const synthRes = await fetchWithRetry({
        model: "claude-sonnet-4-6",
        max_tokens: 4000,
        messages: [{ role: "user", content: synthPrompt }],
      }, "synthesis");

      const synthD = await synthRes.json();
      if (synthD.error) throw new Error(`Synthesis error: ${JSON.stringify(synthD.error).slice(0, 120)}`);
      if (synthD.stop_reason === "max_tokens") throw new Error("Synthesis response was cut off — retry.");

      const synthRaw = (synthD.content || []).map(b => b.text || "").join("").trim();
      const synthStr = synthRaw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
      let synth;
      try { synth = JSON.parse(synthStr); }
      catch { throw new Error(`Synthesis parse error. First 200 chars: ${synthRaw.slice(0, 200)}`); }

      // ── Deep-dive enrichment pass — separate call, much smaller output ──
      // Generates timeline / impact / affected-students per finding without
      // blowing the token budget in the main synthesis call.
      setProgress(p => ({ ...p, synthesising: "deepdive" }));
      const findings = synth.findings || [];
      let enrichedFindings = findings;
      if (findings.length > 0) {
        const deepDivePrompt = `Enrich these ${findings.length} findings with deep-dive detail. Use the evidence and student names from the root causes below.

ROOT CAUSES (with affected students):
${mergedRootCauses.slice(0, 10).map(rc => `- ${rc.theme}: students: ${(rc.affected_students||[]).slice(0,5).join(", ")} | evidence: ${(rc.data_points||[]).slice(0,2).join(" | ")}`).join("\n")}

FINDINGS TO ENRICH:
${findings.map((f, i) => `${i+1}. ${f.title}: ${f.detail}`).join("\n")}

Return ONLY a valid JSON array (no object wrapper) — one entry per finding in the same order:
[{"impactAnalysis":"2 sentences on student impact","affectedStudents":[{"name":"Real student name","touchpoints":"e.g. 2 tickets","detail":"what they experienced"}],"responseAnalysis":"How this was handled or not resolved","timeline":[{"date":"e.g. Feb 4","event":"What happened"}]}]

Rules:
- array length must equal ${findings.length}
- affectedStudents must use real names from the root causes above
- timeline should have 2-4 key dated events where known`;

        try {
          const ddRes = await fetchWithRetry({
            model: "claude-sonnet-4-6",
            max_tokens: 4000,
            messages: [{ role: "user", content: deepDivePrompt }],
          }, "deepdive");
          const ddD = await ddRes.json();
          if (!ddD.error && ddD.stop_reason !== "max_tokens") {
            const ddRaw = (ddD.content || []).map(b => b.text || "").join("").trim();
            const ddStr = ddRaw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
            try {
              const deepDives = JSON.parse(ddStr);
              if (Array.isArray(deepDives) && deepDives.length === findings.length) {
                enrichedFindings = findings.map((f, i) => ({ ...f, deepDive: deepDives[i] }));
              }
            } catch { /* deepDive enrichment failed — use findings without it */ }
          }
        } catch { /* non-critical — findings still usable without deepDive */ }
      }

      setAnalysis({
        overall,
        records: Object.entries(allSentMap).map(([id, v]) => ({ id, ...v })),
        root_causes: mergedRootCauses,
        convergence,
        findings: enrichedFindings,
        likertAverages,
        summary: synth.summary || allBatchSummaries[allBatchSummaries.length - 1] || "",
        recommendations: synth.recommendations || [],
        ts: new Date().toLocaleString(),
        n: totalRecordsAnalysed,
      });

    } catch (e) {
      setError(e.message || "Unknown error — please retry.");
    } finally {
      setLoading(false);
      setProgress({ current: 0, total: 0, retrying: null, synthesising: false });
    }
  }, []); // stable reference — always reads latest filtered via filteredRef

  return (
    <div style={{ background: C.bg, minHeight: "100vh", color: C.text, fontFamily: '"IBM Plex Sans", system-ui, sans-serif' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,500;8..60,600;8..60,700;8..60,800&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');
        *, *::before, *::after { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: #F5F5F0; }
        ::-webkit-scrollbar-thumb { background: #D4D1CA; border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: #B0AFA8; }
        select option { background: #F5F5F0; color: #1A1A18; }
        input[type="date"]::-webkit-calendar-picker-indicator { cursor: pointer; padding: 2px; opacity: 0.5; }
        input[type="date"]::-webkit-datetime-edit { color: ${C.text}; }
        input[type="date"]::-webkit-datetime-edit-fields-wrapper { color: ${C.text}; }
      `}</style>

      {/* ── Modals (rendered at root so they overlay everything) ── */}
      {showSave  && <SaveModal  filters={filters} analysis={analysis} records={records} onSave={() => { setShowSave(false); }} onClose={() => setShowSave(false)} />}
      {showClear && <ClearModal onConfirm={clearAll} onClose={() => setShowClear(false)} />}
      {showSaved && <SavedPanel onLoad={loadSaved} onClose={() => setShowSaved(false)} />}

      {/* ── Navigation ── */}
      <nav style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: "0 28px", display: "flex", alignItems: "stretch", position: "sticky", top: 0, zIndex: 100, height: 56, boxShadow: "0 1px 4px rgba(0,0,0,0.05)" }}>
        <div style={{ display: "flex", alignItems: "center", marginRight: 40, flexShrink: 0 }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: C.gold, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 800, color: "#fff", marginRight: 10, fontFamily: '"Source Serif 4", Georgia, serif' }}>E</div>
          <div>
            <div style={{ fontSize: 14.5, fontFamily: '"Source Serif 4", Georgia, serif', fontWeight: 700, color: C.text, letterSpacing: "-0.3px", lineHeight: 1.2 }}>EduPulse</div>
            <div style={{ fontSize: 10, color: C.dim, letterSpacing: "0.4px" }}>Analytics</div>
          </div>
        </div>

        {NAV_ITEMS.map(v => (
          <div key={v.id} onClick={() => setView(v.id)} style={{
            display: "flex", alignItems: "center", gap: 6, padding: "0 13px",
            fontSize: 12.5, fontWeight: view===v.id ? 600 : 400,
            cursor: "pointer",
            color: view===v.id ? C.gold : C.muted,
            borderBottom: `2px solid ${view===v.id ? C.gold : "transparent"}`,
            transition: "all 0.15s", whiteSpace: "nowrap", userSelect: "none",
          }}>
            <span style={{ opacity: view===v.id ? 1 : 0.6 }}>{NAV_ICONS[v.id]}</span>
            {v.label}
          </div>
        ))}

        <div style={{ flex: 1 }} />

        {/* Record count pill */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {records.length > 0 && (
            <span style={{ fontSize: 11.5, color: C.mid, background: C.s3, border: `1px solid ${C.border}`, borderRadius: 20, padding: "3px 10px", fontWeight: 500 }}>
              {records.length} records
            </span>
          )}
          <button onClick={() => setShowSaved(true)} style={btnGhost({ fontSize: 12, padding: "5px 12px" })}>
            📂 Saved
          </button>
          {analysis && (
            <button onClick={() => setShowSave(true)} style={btn(C.greenBg, C.green, { border: `1px solid ${C.green}40`, fontSize: 12, padding: "5px 12px" })}>
              💾 Save
            </button>
          )}
          <button onClick={() => setShowClear(true)} style={btnDanger({ fontSize: 12, padding: "5px 12px" })}>
            🗑 Clear
          </button>
        </div>
      </nav>

      {/* ── Page body ── */}
      <div style={{ padding: "28px 32px", maxWidth: 1400, margin: "0 auto" }}>
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span style={{ color: C.gold, opacity: 0.7 }}>{NAV_ICONS[view]}</span>
            <h1 style={{ fontSize: 24, fontFamily: '"Source Serif 4", Georgia, serif', fontWeight: 700, color: C.text, margin: 0, letterSpacing: "-0.4px" }}>
              {NAV_ITEMS.find(n=>n.id===view)?.label}
            </h1>
          </div>
          <p style={{ fontSize: 13, color: C.muted, margin: 0, lineHeight: 1.5 }}>{VIEW_SUBTITLES[view]}</p>
          <div style={{ height: 1, background: C.border, marginTop: 18 }} />
        </div>

        {/* Upload: full FilterBar with all inputs */}
        {view === "upload" && (
          <FilterBar
            filters={filters} setFilters={setFilters}
            showFilters={showFilters} setShowFilters={setShowFilters}
            activeFiltersCount={activeFiltersCount}
          />
        )}

        {/* Analysis pages: compact ChannelBar — source toggles + locked context + Save/Clear */}
        {view !== "upload" && (
          <ChannelBar
            filters={filters} setFilters={setFilters}
            records={records} analysis={analysis}
            onSave={() => setShowSave(true)}
            onClearConfirm={() => setShowClear(true)}
          />
        )}

        {view==="upload"    && <UploadView up={up} setUp={setUp} records={records} setRecords={setRecords} setAnalysis={setAnalysis} setView={setView} filters={filters} />}
        {view==="dashboard" && <DashboardView stats={stats} filtered={filtered} analysis={analysis} setView={setView} />}
        {view==="sentiment" && <SentimentView filtered={filtered} analysis={analysis} loading={loading} progress={progress} error={error} runAnalysis={runAnalysis} />}
        {view==="rootcause" && <RootCauseView analysis={analysis} loading={loading} progress={progress} error={error} runAnalysis={runAnalysis} />}
        {view==="findings"  && <FindingsView analysis={analysis} filtered={filtered} loading={loading} progress={progress} error={error} runAnalysis={runAnalysis} />}
        {view==="explore"   && <ExplorerView filtered={filtered} />}
      </div>
    </div>
  );
}
