import express from "express";
import path from 'path'
import { fileURLToPath } from 'url'
import { existsSync, readFileSync } from 'fs'
import { parseBmadProject, updateStoryStatus, updateEpicStatus, toggleAcceptanceCriteria, toggleTask, BOARD_COLUMNS } from "../parser/index.js";
import type { BmadProject } from "../types/index.js";
import type { BoardStatus } from "../parser/index.js";

export function createServer(project: BmadProject, port: number, devSrcDir?: string, projectDir?: string) {
  const app = express();
  app.use(express.json());

  const sseClients = new Set<express.Response>()

  app.get('/api/updates', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders()

    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 25_000)
    sseClients.add(res)
    req.on('close', () => {
      clearInterval(heartbeat)
      sseClients.delete(res)
    })
  })

  // Returns the same lean payload as the injected data / SSE. Notably omits
  // `raw` (every parsed file's contents — multiple MB on a real project);
  // document bodies are served on demand by /api/document instead.
  app.get("/api/project", (_req, res) => res.json(buildPayload(project)));
  app.get("/api/epics", (_req, res) => res.json(project.epics));
  app.get("/api/epics/:id", (req, res) => {
    const epic = project.epics.find((e) => e.id === req.params.id);
    if (!epic) return res.status(404).json({ error: "Epic not found" });
    res.json(epic);
  });
  app.get("/api/commits", (_req, res) => res.json(project.commitMappings ?? []));
  app.get("/api/documents", (_req, res) => res.json(project.documents ?? []));

  app.get("/api/document", (req, res) => {
    const id = typeof req.query.id === "string" ? req.query.id : "";
    const doc = (project.documents ?? []).find((d) => d.id === id);
    if (!doc) return res.status(404).json({ error: "Document not found" });
    const projectDirAbs = project.config ? path.resolve(project.config.projectDir) : null;
    const abs = path.resolve(projectDirAbs ?? ".", doc.path);
    // Path-traversal guard: the resolved file must stay inside the project dir.
    if (projectDirAbs && !abs.startsWith(projectDirAbs + path.sep)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    try {
      const content = readFileSync(abs, "utf-8");
      return res.json({ ...doc, content });
    } catch {
      return res.status(404).json({ error: "File not found" });
    }
  });

  app.get("/api/epics/:epicId/stories/:storyId/markdown", (req, res) => {
    const epic = project.epics.find((e) => e.id === req.params.epicId);
    if (!epic) return res.status(404).json({ error: "Epic not found" });
    const story = epic.stories.find((s) => s.id === req.params.storyId);
    if (!story) return res.status(404).json({ error: "Story not found" });
    if (!story.sourceFile) return res.status(404).json({ error: "No source file for this story" });
    try {
      const content = readFileSync(story.sourceFile, 'utf-8');
      return res.type('text/plain').send(content);
    } catch {
      return res.status(404).json({ error: "File not found" });
    }
  });

  const EPIC_STATUSES = ["backlog", "in-progress", "done"];
  app.patch("/api/epics/:epicId/status", (req, res) => {
    const { status } = req.body as { status: string };
    if (!EPIC_STATUSES.includes(status))
      return res.status(400).json({ error: "Invalid epic status" });
    const result = updateEpicStatus(project, req.params.epicId, status);
    if (!result.ok) return res.status(404).json({ error: result.error });
    res.json({ ok: true });
  });

  app.patch("/api/epics/:epicId/stories/:storyId/status", (req, res) => {
    const { epicId, storyId } = req.params;
    const { status } = req.body as { status: string };
    if (!BOARD_COLUMNS.includes(status as BoardStatus))
      return res.status(400).json({ error: `Invalid status` });
    const result = updateStoryStatus(project, epicId, storyId, status as BoardStatus);
    if (!result.ok) return res.status(404).json({ error: result.error });
    res.json({ ok: true });
  });

  app.patch("/api/epics/:epicId/stories/:storyId/ac/:acIndex", (req, res) => {
    const { epicId, storyId, acIndex } = req.params;
    const { done } = req.body as { done: boolean };
    const idx = parseInt(acIndex, 10);
    if (isNaN(idx) || typeof done !== "boolean")
      return res.status(400).json({ error: "Invalid request" });
    const result = toggleAcceptanceCriteria(project, epicId, storyId, idx, done);
    if (!result.ok) return res.status(404).json({ error: result.error });
    res.json({ ok: true });
  });

  app.patch("/api/epics/:epicId/stories/:storyId/task/:taskId", (req, res) => {
    const { epicId, storyId, taskId } = req.params;
    const { done } = req.body as { done: boolean };
    if (typeof done !== "boolean") return res.status(400).json({ error: "Invalid request" });
    const result = toggleTask(project, epicId, storyId, taskId, done);
    if (!result.ok) return res.status(404).json({ error: result.error });
    res.json({ ok: true });
  });

  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  const publicDir = path.join(__dirname, '..', 'public')

  // Payload shared by the injected __INITIAL_DATA__ and SSE broadcasts.
  // Omits `raw` (can be hundreds of KB) but includes docs metadata + sprint status.
  function buildPayload(p: BmadProject) {
    return {
      name: p.name,
      epics: p.epics,
      commits: p.commitMappings ?? [],
      documents: p.documents ?? [],
      sprintStatus: p.sprintStatus ?? null,
      config: p.config ?? null,
      frMap: p.frMap ?? [],
      nextStep: p.nextStep ?? null,
      risks: p.risks ?? [],
    }
  }

  // ─── HTML Injection ───
  function serveHtml(project: BmadProject): string {
    const indexPath = path.join(publicDir, 'index.html')
    const html = readFileSync(indexPath, 'utf-8')
    const data = JSON.stringify(buildPayload(project)).replace(/<\/script>/g, '<\\/script>')
    const script = `<script>window.__INITIAL_DATA__ = ${data};<\/script>`
    return html.replace('</head>', `${script}</head>`)
  }

  function broadcast(data: object) {
    const payload = `data: ${JSON.stringify(data)}\n\n`
    for (const client of sseClients) {
      client.write(payload)
    }
  }

  if (projectDir) {
    import('chokidar').then(({ watch }) => {
      let debounceTimer: ReturnType<typeof setTimeout> | null = null

      const watcher = watch(projectDir, {
        ignored: /(^|[/\\])(\.|node_modules)/,
        persistent: true,
        ignoreInitial: true,
      })

      const handleChange = (changedPath: string) => {
        if (!changedPath.endsWith('.md')) return
        if (debounceTimer) clearTimeout(debounceTimer)
        debounceTimer = setTimeout(() => {
          try {
            const updated = parseBmadProject({ dir: projectDir })
            updated.commitMappings = project.commitMappings
            Object.assign(project, updated)
            broadcast(buildPayload(project))
            console.log(`  [watch] Updated after change in ${changedPath}`)
          } catch (err: any) {
            console.error(`  [watch] Re-parse failed: ${err.message}`)
          }
        }, 300)
      }

      watcher.on('add', handleChange)
      watcher.on('change', handleChange)
      watcher.on('unlink', handleChange)
    })
  }

  if (existsSync(publicDir)) {
    // index:false so "/" falls through to the SPA handler below, which injects
    // __INITIAL_DATA__. Without it express.static would serve index.html
    // directly and the client would have to round-trip to /api/project.
    app.use(express.static(publicDir, { index: false }))
    app.get('*', (_req, res) => {
      res.setHeader('Content-Type', 'text/html')
      res.send(serveHtml(project))
    })
    app.listen(port, () => {
      console.log(`\n  BMAD Dashboard running at http://localhost:${port}\n`);
    });
  } else if (devSrcDir) {
    // Dev mode: mount Vite as middleware so everything is on one port
    const clientRoot = path.join(devSrcDir, 'client')
    const configFile = path.join(devSrcDir, '..', 'vite.config.ts')
    import('vite').then(({ createServer: createVite }) =>
      createVite({
        root: clientRoot,
        configFile,
        server: { middlewareMode: true },
        appType: 'spa',
      })
    ).then((vite) => {
      app.use(vite.middlewares)
      app.listen(port, () => {
        console.log(`\n  BMAD Dashboard running at http://localhost:${port}\n`);
      });
    });
  } else {
    app.listen(port, () => {
      console.log(`\n  BMAD Dashboard running at http://localhost:${port}\n`);
      console.log(`  Build not found. Run "npm run build" first.\n`);
    });
  }
}
