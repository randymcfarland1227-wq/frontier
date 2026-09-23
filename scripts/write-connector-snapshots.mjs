#!/usr/bin/env node
/**
 * Write Life Hub SourceSnapshot JSON files into public/data/.
 *
 * Usage:
 *   # From pre-mapped snapshots in a directory (default /tmp/lifehub-sync)
 *   node scripts/write-connector-snapshots.mjs
 *   node scripts/write-connector-snapshots.mjs --dir /tmp/lifehub-sync
 *
 *   # Single snapshot on stdin
 *   cat gmail.json | node scripts/write-connector-snapshots.mjs --stdin
 *
 *   # Explicit files
 *   node scripts/write-connector-snapshots.mjs --file /tmp/lifehub-sync/gmail.json
 *
 * Expected filenames in --dir: gmail.json, radall.json, outlook.json, ticktick.json
 * (or *-snapshot.json). Also accepts raw dumps named *-raw.json via --map-raw.
 *
 * Does NOT call MCP. An agent dumps connector data, maps to SourceSnapshot, then
 * runs this script (or writes public/data directly), then commits + pushes.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'public', 'data');
const CONNECTOR_IDS = ['gmail', 'radall', 'outlook', 'ticktick'];

function usage() {
  console.log(`Usage:
  node scripts/write-connector-snapshots.mjs [--dir DIR] [--map-raw]
  node scripts/write-connector-snapshots.mjs --stdin
  node scripts/write-connector-snapshots.mjs --file PATH
`);
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function validateSnapshot(snap, expectedSource) {
  if (!isPlainObject(snap)) throw new Error('Snapshot must be an object');
  if (!CONNECTOR_IDS.includes(snap.source) && snap.source !== expectedSource) {
    throw new Error(`Invalid source: ${snap.source}`);
  }
  if (expectedSource && snap.source !== expectedSource) {
    throw new Error(`Expected source ${expectedSource}, got ${snap.source}`);
  }
  if (!isPlainObject(snap.metrics)) throw new Error('metrics must be an object');
  for (const [k, v] of Object.entries(snap.metrics)) {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new Error(`metrics.${k} must be a finite number`);
    }
  }
  if (!Array.isArray(snap.featured)) throw new Error('featured must be an array');
  if (!Array.isArray(snap.tasks)) throw new Error('tasks must be an array');
  if (typeof snap.refreshedAt !== 'string' || !snap.refreshedAt) {
    throw new Error('refreshedAt must be a non-empty ISO string');
  }
  for (const item of snap.featured) {
    if (!item?.id || !item?.title) throw new Error('featured items need id + title');
  }
  for (const task of snap.tasks) {
    if (!task?.id || !task?.title) throw new Error('tasks need id + title');
  }
  return snap;
}

function decodeHtml(s = '') {
  return String(s)
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

function mapGmailRaw(raw, refreshedAt) {
  const threads = Array.isArray(raw?.threads) ? raw.threads : [];
  const featured = [];
  const tasks = [];
  let unread = 0;

  for (const thread of threads.slice(0, 30)) {
    const msgs = Array.isArray(thread.messages) ? thread.messages : [];
    const labels = new Set();
    for (const m of msgs) for (const l of m.labelIds || []) labels.add(l);
    if (labels.has('UNREAD')) unread += 1;

    // Prefer earliest inbound for title/snippet; fall back to starred or first.
    const inbound =
      msgs.find(m => !(m.labelIds || []).includes('SENT')) ||
      msgs.find(m => (m.labelIds || []).includes('STARRED')) ||
      msgs[0] ||
      {};
    const subject = decodeHtml(inbound.subject || '(no subject)');
    const snippet = decodeHtml(inbound.snippet || '');
    const from = inbound.sender || '';
    const originUrl = thread.viewUrl || inbound.viewUrl || '';
    const id = String(thread.id || inbound.threadId || inbound.id);

    featured.push({
      id,
      title: subject,
      detail: snippet.slice(0, 180),
      meta: from ? `From ${from}` : 'Gmail starred',
      originUrl: originUrl || undefined,
      completable: false,
    });
    tasks.push({
      id,
      title: subject,
      detail: snippet.slice(0, 180),
      status: 'open',
      starred: true,
      originUrl: originUrl || undefined,
    });
  }

  const starred = threads.length;
  return {
    source: 'gmail',
    metrics: { starred, unread, action: starred },
    featured: featured.slice(0, 10),
    tasks,
    refreshedAt,
  };
}

function parseCsvish(content) {
  const lines = String(content || '').split(/\r?\n/).filter(l => l.length);
  return lines.map(line => {
    const cells = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = !inQ;
      } else if (ch === ',' && !inQ) {
        cells.push(cur);
        cur = '';
      } else cur += ch;
    }
    cells.push(cur);
    return cells;
  });
}

function mapRadallRaw(raw, refreshedAt) {
  const sheetUrl =
    raw.spreadsheetUrl ||
    `https://docs.google.com/spreadsheets/d/${raw.spreadsheetId || '19rw8MAYTZ70Qy2GFAi0DaCGdsp7hQc67l8nkvw17jQk'}/edit`;
  const gid = raw.sheetId != null ? String(raw.sheetId) : '138758250';
  const originBase = `${sheetUrl}${sheetUrl.includes('gid=') ? '' : `#gid=${gid}`}`;

  let rows = Array.isArray(raw.rows) ? raw.rows : parseCsvish(raw.content || '');
  // Drop title-only first row if it doesn't look like headers
  if (rows.length && rows[0].length === 1 && /watch\s*list/i.test(rows[0][0] || '')) {
    rows = rows.slice(1);
  }
  if (!rows.length) {
    return {
      source: 'radall',
      metrics: { open: 0, dueSoon: 0, done: 0 },
      featured: [],
      tasks: [],
      refreshedAt,
    };
  }

  const headers = rows[0].map(h => String(h || '').trim().toLowerCase());
  const col = (...names) => {
    for (const n of names) {
      const i = headers.findIndex(h => h === n || h.includes(n));
      if (i >= 0) return i;
    }
    return -1;
  };
  const iTask = col('task', 'title', 'item', 'name');
  const iType = col('type', 'category');
  const iAmount = col('amount', 'cost', '$');
  const iDue = col('due date', 'due', 'deadline');
  const iStatus = col('status', 'state');
  const iStar = col('star', 'starred', 'priority');

  const now = Date.now();
  const soon = now + 7 * 24 * 60 * 60 * 1000;
  const tasks = [];
  let open = 0;
  let dueSoon = 0;
  let done = 0;

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || !row.some(c => String(c || '').trim())) continue;
    const title = String(row[iTask >= 0 ? iTask : 0] || '').trim();
    if (!title || /^task$/i.test(title)) continue;

    const statusRaw = iStatus >= 0 ? String(row[iStatus] || '').trim().toLowerCase() : '';
    const status =
      /done|paid|complete|closed/i.test(statusRaw) ? 'done'
        : /block/i.test(statusRaw) ? 'blocked'
          : 'open';
    if (status === 'done') done += 1;
    else open += 1;

    const due = iDue >= 0 ? String(row[iDue] || '').trim() : '';
    if (due && status !== 'done') {
      const d = Date.parse(due);
      if (!Number.isNaN(d) && d <= soon) dueSoon += 1;
    }

    const type = iType >= 0 ? String(row[iType] || '').trim() : '';
    const amount = iAmount >= 0 ? String(row[iAmount] || '').trim() : '';
    const starred =
      iStar >= 0
        ? /^(1|true|yes|y|★|\*|star)/i.test(String(row[iStar] || '').trim())
        : false;

    const detail = [type, amount ? `Amount ${amount}` : ''].filter(Boolean).join(' · ');
    tasks.push({
      id: `radall-row-${r + 1}`,
      title,
      detail: detail || undefined,
      status,
      due: due || undefined,
      starred,
      originUrl: originBase,
    });
  }

  const featured = tasks
    .filter(t => t.starred || t.status === 'open')
    .slice(0, 8)
    .map(t => ({
      id: t.id,
      title: t.title,
      detail: t.detail || '',
      meta: [t.status, t.due ? `due ${t.due}` : null].filter(Boolean).join(' · ') || 'Radall',
      originUrl: t.originUrl,
      completable: false,
    }));

  return {
    source: 'radall',
    metrics: { open, dueSoon, done },
    featured,
    tasks,
    refreshedAt,
  };
}

const JOB_RE =
  /\b(job|interview|application|opportunity|recruiter|hiring|linkedin|indeed|greenhouse|lever|workday|career)\b/i;

function mapOutlookRaw(raw, refreshedAt) {
  const messages = Array.isArray(raw?.value) ? raw.value : Array.isArray(raw) ? raw : [];
  const jobLike = messages.filter(m => {
    const blob = [
      m.subject,
      m.bodyPreview,
      m.from?.emailAddress?.name,
      m.from?.emailAddress?.address,
    ]
      .filter(Boolean)
      .join(' ');
    return JOB_RE.test(blob);
  });

  // Prefer job-like; if Graph search/inbox yielded none matching, keep empty (no fabrication).
  const pool = jobLike;
  const featured = [];
  const tasks = [];
  let unread = 0;
  let followUp = 0;

  for (const m of pool.slice(0, 30)) {
    const id = String(m.id);
    const subject = m.subject || '(no subject)';
    const from =
      m.from?.emailAddress?.name || m.from?.emailAddress?.address || 'Outlook';
    const preview = String(m.bodyPreview || '').replace(/\s+/g, ' ').slice(0, 180);
    const originUrl = m.webLink || undefined;
    const isUnread = m.isRead === false;
    const flagged = m.flag?.flagStatus === 'flagged';
    if (isUnread) unread += 1;
    if (isUnread || flagged) followUp += 1;

    if (isUnread || flagged || featured.length < 8) {
      featured.push({
        id,
        title: subject,
        detail: preview,
        meta: `${from}${isUnread ? ' · unread' : ''}${flagged ? ' · flagged' : ''}`,
        originUrl,
        completable: false,
      });
    }
    tasks.push({
      id,
      title: subject,
      detail: preview,
      status: 'open',
      starred: flagged,
      originUrl,
    });
  }

  // Dedupe featured by id, prefer unread/flagged first
  const seen = new Set();
  const featuredUnique = [];
  for (const f of featured) {
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    featuredUnique.push(f);
  }

  return {
    source: 'outlook',
    metrics: {
      inquiries: pool.length,
      unread,
      followUp,
    },
    featured: featuredUnique.slice(0, 10),
    tasks,
    refreshedAt,
  };
}

function emptyTickTick(refreshedAt) {
  return {
    source: 'ticktick',
    metrics: { open: 0, habits: 0, overdue: 0 },
    featured: [
      {
        id: 'ticktick-token-pending',
        title: 'TickTick token pending',
        detail: 'Set TICKTICK_ACCESS_TOKEN on the sync box, then re-run the connector sync.',
        meta: 'Stub',
        completable: false,
      },
    ],
    tasks: [],
    refreshedAt,
  };
}

function writeSnapshot(snap) {
  validateSnapshot(snap);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const out = path.join(DATA_DIR, `${snap.source}.json`);
  fs.writeFileSync(out, `${JSON.stringify(snap, null, 2)}\n`, 'utf8');
  console.log(`wrote ${path.relative(ROOT, out)} (${snap.tasks.length} tasks, ${snap.featured.length} featured)`);
  return out;
}

function writeManifest(ids, refreshedAt) {
  const manifest = {
    sources: ids,
    refreshedAt,
    note: 'Static connector snapshots for GitHub Pages. Refresh by agent MCP sync + commit.',
  };
  const out = path.join(DATA_DIR, 'manifest.json');
  fs.writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`wrote ${path.relative(ROOT, out)}`);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function resolveCandidates(dir, id) {
  const names = [
    `${id}.json`,
    `${id}-snapshot.json`,
    `${id}.snapshot.json`,
  ];
  for (const n of names) {
    const p = path.join(dir, n);
    if (fs.existsSync(p)) return { path: p, kind: 'snapshot' };
  }
  const raw = path.join(dir, `${id}-raw.json`);
  if (fs.existsSync(raw)) return { path: raw, kind: 'raw' };
  return null;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('-h') || args.includes('--help')) {
    usage();
    process.exit(0);
  }

  const refreshedAt = new Date().toISOString();
  const written = [];

  if (args.includes('--stdin')) {
    const text = await readStdin();
    const snap = validateSnapshot(JSON.parse(text));
    writeSnapshot({ ...snap, refreshedAt: snap.refreshedAt || refreshedAt });
    written.push(snap.source);
    writeManifest(written, refreshedAt);
    return;
  }

  const fileIdx = args.indexOf('--file');
  if (fileIdx >= 0) {
    const file = args[fileIdx + 1];
    if (!file) throw new Error('--file requires a path');
    const snap = validateSnapshot(readJson(file));
    writeSnapshot({ ...snap, refreshedAt: snap.refreshedAt || refreshedAt });
    written.push(snap.source);
    // merge with existing manifest sources if present
    let sources = [...written];
    const manPath = path.join(DATA_DIR, 'manifest.json');
    if (fs.existsSync(manPath)) {
      try {
        const man = readJson(manPath);
        sources = [...new Set([...(man.sources || []), ...written])];
      } catch {
        /* ignore */
      }
    }
    writeManifest(sources, refreshedAt);
    return;
  }

  const dirIdx = args.indexOf('--dir');
  const dir = dirIdx >= 0 ? path.resolve(args[dirIdx + 1]) : '/tmp/lifehub-sync';
  const mapRaw = args.includes('--map-raw') || true;

  if (!fs.existsSync(dir)) {
    console.error(`Directory not found: ${dir}`);
    process.exit(1);
  }

  for (const id of CONNECTOR_IDS) {
    const found = resolveCandidates(dir, id);
    if (!found) {
      if (id === 'ticktick') {
        writeSnapshot(emptyTickTick(refreshedAt));
        written.push(id);
      } else {
        console.warn(`skip ${id}: no snapshot or raw dump in ${dir}`);
      }
      continue;
    }

    const data = readJson(found.path);
    if (found.kind === 'snapshot' && data.source) {
      writeSnapshot(validateSnapshot({ ...data, refreshedAt: data.refreshedAt || refreshedAt }, id));
      written.push(id);
      continue;
    }

    if (!mapRaw) {
      console.warn(`skip ${id}: found raw dump but --map-raw not set`);
      continue;
    }

    let snap;
    if (id === 'gmail') snap = mapGmailRaw(data, refreshedAt);
    else if (id === 'radall') snap = mapRadallRaw(data, refreshedAt);
    else if (id === 'outlook') snap = mapOutlookRaw(data, refreshedAt);
    else if (id === 'ticktick') snap = emptyTickTick(refreshedAt);
    writeSnapshot(validateSnapshot(snap, id));
    written.push(id);
  }

  writeManifest(written.length ? written : CONNECTOR_IDS, refreshedAt);
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
