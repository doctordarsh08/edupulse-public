# EduPulse Analytics

**Multi-source learner feedback intelligence platform for online higher education.**

EduPulse ingests feedback from four channels — Course Surveys, LMS Chat, Support Tickets,
and Live Session transcripts — and uses Claude AI to surface sentiment scores, root causes,
cross-channel findings, and actionable recommendations across your entire learner cohort.

![EduPulse Analytics](https://img.shields.io/badge/React-18-blue) ![Vite](https://img.shields.io/badge/Vite-5-purple) ![Claude](https://img.shields.io/badge/Claude-Sonnet_4.6-teal)

---

## Features

- **Multi-source ingestion** — CSV and XLSX, auto column detection (heuristic + AI fallback)
- **Import-time filtering** — staff match, enrolled student list, date range
- **Per-record AI classification** — sentiment (positive/neutral/negative), score (1–5), concern label, themes
- **Map-reduce analysis** — batched classification passes + one full-dataset synthesis pass
- **Cross-channel findings** — convergence table, Likert bar chart, expandable deep-dives with timeline
- **Save & restore** — full analysis snapshots stored in `localStorage`, viewable without re-running
- **No backend** — API key lives only in the user's browser, direct calls to Anthropic

## Stack

| Layer | Library |
|---|---|
| UI | React 18 + Vite |
| Charts | Recharts |
| File parsing | SheetJS (XLSX) + PapaParse |
| AI | Anthropic Claude Sonnet 4.6 |

## Getting started

### Prerequisites
- Node.js 18+
- An [Anthropic API key](https://console.anthropic.com)

### Run locally

```bash
git clone https://github.com/YOUR_USERNAME/edupulse-analytics.git
cd edupulse-analytics
npm install
npm run dev
```

Open http://localhost:5173. On first load the app asks for your Anthropic API key —
it's stored in `localStorage` only and never leaves your browser.

### Build for production

```bash
npm run build    # outputs to dist/
```

Deploy the `dist/` folder to any static host (Netlify, Vercel, GitHub Pages, Render).

> **Note:** Direct browser-to-Anthropic API calls require the
> `anthropic-dangerous-direct-browser-access` header. This is fine for personal/internal
> tools. For a public-facing deployment, replace `apiHeaders()` with calls to your own
> backend proxy that holds the key server-side.

## How it works

### Import pipeline
1. Drop a CSV or XLSX file and select the source type
2. Columns are detected automatically (heuristic scoring → Claude fallback)
3. Source-specific filters apply at import time:
   - **Survey** — accept all rows with content, dedup by email + course
   - **LMS Chat / Live Session** — staff match → student list → date range
   - **Support Ticket** — student list → date range

### Analysis pipeline
```
N records
  → split into batches (15–25 depending on source)
  → each batch: classify sentiment + score + concern + themes per record
              + extract root causes
  → merge root causes across all batches (dedupe by theme, sum counts)
  → synthesis pass: full-dataset findings + summary + recommendations
  → deep-dive pass: timeline + impact analysis + affected students per finding
```

### Saved analyses
Analyses are saved to `localStorage` as full JSON payloads (findings, root causes,
Likert averages, recommendations). Open **📂 Saved** in the nav to view or load them.

## Customising for your course

The `DOMAIN_CONTEXT` in `runAnalysis` (around line 2200 in `App.jsx`) contains 10 known
recurring themes that bias the AI toward patterns common in online higher education.
Replace these with themes relevant to your own course for better classification accuracy.

## Project structure

```
src/
  App.jsx      — entire app (single-file React component tree)
  main.jsx     — Vite entry point
index.html
vite.config.js
package.json
```

## Contributing

Issues and PRs welcome. This is a solo-built portfolio project.

## License

MIT
