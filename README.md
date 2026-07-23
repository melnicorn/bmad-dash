# bmad-dash

*An unofficial, experimental dashboard for the [BMAD Method](https://github.com/bmad-code-org/BMAD-METHOD).*

Visualize BMAD epics, user stories, **and the full set of planning documents** (PRD, architecture, briefs, UX designs, specs, retrospectives, and more) from a project's `.md` files on a localhost dashboard, with **rendered Mermaid diagrams** and a **light / dark / system theme**. Optionally uses local AI (Transformers.js) to match git commits to stories.

[Screenshots](#screenshots)

> `bmad-dash` is a fork of [`bmad-visio`](https://github.com/williammesi/bmad-visio) by William Mesiti, extended with full document visibility, cross-linking, sprint-status integration, filtering, Mermaid diagram rendering, and a light/dark/system theme.

## Quick Start

```bash
npx @melnicorn/bmad-dash
```

Run from your project root. It reads your BMAD install config to locate artifacts, so it works with customized paths:

- **BMAD v6** — reads `_bmad/bmm/config.yaml` for `planning_artifacts`, `implementation_artifacts`, and `project_knowledge`; treats `sprint-status.yaml` as the authoritative status source.
- **BMAD v4 / v5** — reads `.bmad-core/core-config.{yaml,yml}` (`docs/stories/`, `docs/prd/`).
- **Fallback** — globs the default `_bmad-output/` layout when no config file is present.

## Features

- **Next steps** — Tells you what to do next using BMAD's own recommendation ladder (in-progress → review → ready-for-dev → backlog → retrospective), with a copyable workflow command and risk warnings (stale sprint status, orphaned stories, status drift)
- **Epic overview** — Grid of all epics with story counts, status, and progress
- **Epic board** — Project-level Backlog / In Progress / Done board driven by `sprint-status.yaml`, with story rollups and blocking-dependency badges
- **Kanban board** — Stories in 4 columns: To Do → Active → Review → Done
- **Drag & drop** — Move stories or epics between columns; writes status back to the `.md` file **and** `sprint-status.yaml`
- **Story detail** — Acceptance criteria, tasks with checkboxes, progress ring, related commits with a "why did this match?" signal breakdown
- **Documents browser** — Browse and read every BMAD document, grouped by type and initiative, with a table of contents and rendered Markdown — no more opening raw files
- **Mermaid diagrams** — Diagrams in Markdown render inline, with pan/zoom controls (scroll or drag, or +/−/reset buttons) plus expand and fullscreen modes; they follow the active light/dark theme
- **Theme** — Light, dark, or system (follows your OS) — toggle in the top bar, persisted across sessions with no flash on load; code blocks and Mermaid diagrams re-theme to match
- **Cross-linking** — Follow a document's `inputDocuments` graph (upstream inputs and downstream "used by" backlinks), jump from an epic to its dependencies and requirements, and click through internal `.md` links in-app
- **Filtering** — Hide completed epics or stories and text-filter across the sidebar, overview, and boards (persisted across sessions)
- **Traceability** — Epic dependency edges (`Depends on: Epic N`) and the FR Coverage Map parsed from `epics.md`
- **Git commit matching** — AI-powered mapping of commits to stories (optional)
- **Live editing** — Toggle AC and tasks directly; the dashboard watches the filesystem and updates on change

## AI Commit Matching

Install the optional dependency for commit-to-story matching:

```bash
npm install @huggingface/transformers
```

The dashboard will then:

1. Parse your git history
2. Embed stories and commits with `bge-small-en-v1.5`
3. Re-rank ambiguous matches with zero-shot NLI (`nli-deberta-v3-small`)
4. Persist mappings in `bmad-dash/gitmap.json` (migrates an existing `bmad-visio/gitmap.json` if present)
5. Show related commits on each story's detail page

First run downloads models locally. Everything runs on-device, no API keys needed.

### Offline / behind a proxy (`--no-ai`)

The first run fetches the models from `huggingface.co`. If that host is blocked (e.g. a corporate proxy), the download fails. Run with `--no-ai` (alias `--no-model`) to match commits **entirely offline** — no model download, no network access:

```bash
npx @melnicorn/bmad-dash --no-ai
```

Heuristic mode still matches commits that **explicitly reference a story** (e.g. `STORY-1.2`, `#1.2` in the message) and surfaces weaker keyword/path/diff signals, but without the embedding + NLI stages it won't catch matches that rely on semantic similarity alone. These results are computed fresh each launch and are **not** written to `gitmap.json`, so a later online run still gets a full, cached AI pass.

Use `--no-git` instead if you want to skip commit matching altogether.

## Options

```
npx @melnicorn/bmad-dash [path] [options]

Arguments:
  path              Project root (default: .)

Options:
  -p, --port <n>    Port number (default: 3334)
  --no-git          Skip git commit matching entirely
  --no-ai           Match commits offline via heuristics only — no AI model
                    download (alias: --no-model)
  --debug           Dump parsed data as JSON and exit
  -h, --help        Show help
```

## Status Mapping

| BMAD Status                          | Board Column     |
| ------------------------------------ | ---------------- |
| `backlog`, `ready-for-dev`           | To Do            |
| `in-progress`                        | Active           |
| `review`                             | Ready for Review |
| `done`, `complete`, `cancelled`      | Done             |

Epic and retrospective status come from `sprint-status.yaml` when present.

## Development

```bash
pnpm install
pnpm dev -- /path/to/bmad/project      # tsx, no build step
pnpm build                             # server (tsc) + client (vite)
pnpm test                              # vitest
```

## License

MIT — see [LICENSE](LICENSE). Originally created by William Mesiti as `bmad-visio`.

## Screenshots

### Overview

The epic overview grid shows all epics with story counts and progress bars at a glance.

![Overview](screenshots/OVERVIEW.png)

### Kanban

The kanban board displays stories across four columns: To Do, Active, Ready for Review, and Done. Stories can be dragged between columns.

![Kanban](screenshots/KANBAN.png)

### Story Detail View

The story detail view shows acceptance criteria, tasks with checkboxes, a progress ring, and related git commits.

![Story Detail View](screenshots/STORYDETAILVIEW.png)

### Documents & Mermaid

The documents browser groups every BMAD document by type and initiative, renders Markdown with a table of contents, and draws Mermaid diagrams inline with pan/zoom, expand, and fullscreen controls.

![Documents browser with Mermaid diagram — dark](screenshots/DOCUMENTS.png)

### Light Theme

Light, dark, and system themes are available from the top-bar toggle and persist across sessions; code blocks and Mermaid diagrams re-theme to match.

![Documents browser — light theme](screenshots/DOCUMENTS_LIGHT.png)
