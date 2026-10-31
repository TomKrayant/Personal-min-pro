'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const zlib = require('node:zlib');
const { EventEmitter } = require('node:events');

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const DEFAULT_CONTEXT_WINDOW = 1048576;

function decodeZstdFrames(buffer) {
  let text = '';
  let position = 0;
  while (position < buffer.length) {
    const start = buffer.indexOf(ZSTD_MAGIC, position);
    if (start < 0) break;
    let probe = start + 4;
    let decoded = null;
    let end = buffer.length;
    while (probe <= buffer.length) {
      const next = buffer.indexOf(ZSTD_MAGIC, probe);
      end = next < 0 ? buffer.length : next;
      try {
        decoded = zlib.zstdDecompressSync(buffer.subarray(start, end));
        break;
      } catch {
        if (next < 0) break;
        probe = next + 4;
      }
    }
    if (decoded === null) {
      position = start + 4;
      continue;
    }
    text += decoded.toString('utf8');
    position = end;
  }
  return text;
}

function readSessionFile(file) {
  const buffer = fs.readFileSync(file);
  if (file.endsWith('.zstd')) return decodeZstdFrames(buffer);
  return buffer.toString('utf8');
}

function parseEntries(text) {
  const entries = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    try {
      const entry = JSON.parse(line);
      if (entry && typeof entry === 'object') entries.push(entry);
    } catch {
      // A partially appended line is expected while DSH is writing.
    }
  }
  return entries;
}

function pickNumber(...values) {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return 0;
}

function normalizeUsage(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const inputTokens = pickNumber(usage.inputTokens, usage.uncachedInputTokens);
  const outputTokens = pickNumber(usage.outputTokens);
  const cacheReadTokens = pickNumber(usage.cacheReadTokens);
  const cacheWriteTokens = pickNumber(usage.cacheWriteTokens);
  const totalTokens = pickNumber(usage.totalTokens, inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens);
  if (totalTokens <= 0 && inputTokens <= 0 && outputTokens <= 0) return null;
  return { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, totalTokens };
}

function reasonKind(reason) {
  if (typeof reason === 'string') return reason;
  if (reason && typeof reason === 'object') {
    return String(reason.kind || reason.code || reason.type || '');
  }
  return '';
}

function titleFromCwd(cwd) {
  if (!cwd) return 'DSH 会话';
  const base = path.basename(cwd.replace(/[\\/]+$/, ''));
  return base || cwd;
}

function toolLabel(name) {
  const value = String(name || '').toLowerCase();
  if (value === 'pwsh' || value === 'bash' || value === 'terminal') return '跑命令';
  if (value === 'read' || value === 'glob' || value === 'grep') return '翻文件';
  if (value === 'write' || value === 'edit' || value === 'str_replace_editor') return '写文件';
  if (value === 'web_search' || value === 'web_fetch') return '查资料';
  if (value === 'subagent' || value === 'workflow') return '分身干活';
  if (value === 'present') return '整理成果';
  return name || '工具';
}

function analyzeSession(file, stat, entries) {
  let meta = null;
  let title = '';
  let contextWindow = 0;
  let model = '';
  let lastEvent = null;
  let activeTurn = null;
  let lastTurnEnd = null;
  let pendingApproval = null;
  let lastDecidedApprovalSeq = -1;
  let lastToolCall = null;
  let lastToolResultSeq = -1;
  let usageSamples = [];
  let lastUsage = null;

  for (const entry of entries) {
    if (!entry || typeof entry.type !== 'string') continue;
    const type = entry.type;
    const seq = Number.isSafeInteger(entry.seq) ? entry.seq : -1;
    const time = Number.isFinite(entry.time) ? entry.time : 0;
    const data = entry.data || {};

    if (!lastEvent || time >= lastEvent.time) {
      lastEvent = { type, seq, time, data };
    }

    if (type === 'session') {
      meta = entry;
      if (!title && entry.id) title = '';
      continue;
    }
    if (type === 'session/title' && typeof data.title === 'string' && data.title.trim()) {
      title = data.title.trim();
      continue;
    }
    if (type === 'request/context') {
      if (typeof data.contextWindow === 'number' && data.contextWindow > 0) contextWindow = data.contextWindow;
      if (typeof data.model === 'string' && data.model) model = data.model;
      continue;
    }
    if (type === 'model/selection') {
      const selected = data.model || data.selected || data.route?.model;
      if (typeof selected === 'string') model = selected;
      else if (selected && typeof selected === 'object' && typeof selected.model === 'string') model = selected.model;
      continue;
    }
    if (type === 'assistant/message') {
      const usage = normalizeUsage(data.usage);
      if (usage) {
        const sample = { ...usage, time: time || stat.mtimeMs, seq, turn: data.turn, step: data.step };
        usageSamples.push(sample);
        lastUsage = sample;
      }
      const messageModel = data.message?.source?.model;
      if (!model && typeof messageModel === 'string') model = messageModel;
      continue;
    }
    if (type === 'turn/start') {
      activeTurn = { turn: data.turn, seq, time };
      lastTurnEnd = null;
      pendingApproval = null;
      continue;
    }
    if (type === 'turn/end') {
      activeTurn = null;
      pendingApproval = null;
      lastTurnEnd = { seq, time, reason: data.reason || data };
      continue;
    }
    if (type === 'approval/asked') {
      pendingApproval = { seq, time, data };
      continue;
    }
    if (type === 'approval/decided') {
      lastDecidedApprovalSeq = Math.max(lastDecidedApprovalSeq, seq);
      if (pendingApproval && seq >= pendingApproval.seq) pendingApproval = null;
      continue;
    }
    if (type === 'tool/call') {
      lastToolCall = {
        seq,
        time,
        name: typeof data.name === 'string' ? data.name : '工具',
      };
      continue;
    }
    if (type === 'tool/result') {
      lastToolResultSeq = Math.max(lastToolResultSeq, seq);
      continue;
    }
  }

  const now = Date.now();
  const lastTime = lastEvent?.time || stat.mtimeMs || 0;
  const active = Boolean(activeTurn);
  const pending = Boolean(pendingApproval && pendingApproval.seq > lastDecidedApprovalSeq);
  let status = 'idle';
  let tone = 'idle';
  let bubble = '呼…呼…';
  let detail = '打盹中';

  if (active && pending) {
    status = 'waiting';
    tone = 'waiting';
    bubble = '这里要你点一下～';
    detail = '等你确认';
  } else if (active) {
    const toolRunning = lastToolCall && lastToolCall.seq > lastToolResultSeq;
    const lastType = lastEvent?.type;
    if (toolRunning) {
      status = 'tool';
      tone = 'running';
      bubble = `${toolLabel(lastToolCall.name)}中…`;
      detail = '正在用工具';
    } else if (lastType === 'step/start' || lastType === 'assistant/message') {
      status = 'thinking';
      tone = 'running';
      bubble = '让虎爷想想…';
      detail = '思考中';
    } else {
      status = 'running';
      tone = 'running';
      bubble = '敲代码中…';
      detail = '正在干活';
    }
  } else if (lastTurnEnd) {
    const kind = reasonKind(lastTurnEnd.reason).toLowerCase();
    const failed = /error|fail|abort|interrupt|cancel/.test(kind);
    const fresh = now - lastTurnEnd.time < (failed ? 20000 : 10000);
    if (fresh) {
      status = failed ? 'failed' : 'done';
      tone = failed ? 'failed' : 'done';
      bubble = failed ? '呜…好像卡住了' : '这轮写完啦！';
      detail = failed ? '出错了' : '搞定啦';
    }
  }

  const totals = usageSamples.reduce((acc, sample) => {
    acc.inputTokens += sample.inputTokens;
    acc.outputTokens += sample.outputTokens;
    acc.cacheReadTokens += sample.cacheReadTokens;
    acc.cacheWriteTokens += sample.cacheWriteTokens;
    acc.totalTokens += sample.totalTokens;
    acc.calls += 1;
    return acc;
  }, { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, calls: 0 });

  const cwd = typeof meta?.cwd === 'string' ? meta.cwd : '';
  const resolvedTitle = title || titleFromCwd(cwd);
  const windowSize = contextWindow || DEFAULT_CONTEXT_WINDOW;
  const contextTokens = lastUsage ? lastUsage.totalTokens : 0;
  const cacheBase = totals.cacheReadTokens + totals.inputTokens;
  const cacheHit = cacheBase > 0 ? (totals.cacheReadTokens / cacheBase) * 100 : 0;

  return {
    file,
    id: typeof meta?.id === 'string' ? meta.id : path.basename(path.dirname(file)),
    cwd,
    title: resolvedTitle,
    project: titleFromCwd(cwd),
    model: model || 'deepseek',
    contextWindow: windowSize,
    contextTokens,
    contextPercent: Math.max(0, Math.min(100, (contextTokens / windowSize) * 100)),
    status,
    tone,
    bubble,
    detail,
    active,
    lastEventType: lastEvent?.type || '',
    lastEventTime: lastTime,
    lastTurnEndTime: lastTurnEnd?.time || 0,
    lastUsageTime: lastUsage?.time || 0,
    totals,
    cacheHit,
    usageSamples,
    updatedAt: now,
    mtimeMs: stat.mtimeMs,
  };
}

class DshMonitor extends EventEmitter {
  constructor(options = {}) {
    super();
    this.dshHome = options.dshHome || process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
    this.sessionRoot = path.join(this.dshHome, 'sessions');
    this.pollMs = options.pollMs || 1500;
    this.cache = new Map();
    this.timer = null;
    this.snapshot = {
      ok: false,
      sessions: [],
      active: null,
      today: { tokens: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, calls: 0, sessions: 0, cacheHit: 0 },
      updatedAt: 0,
      error: '',
    };
  }

  start() {
    if (this.timer) return;
    this.scan();
    this.timer = setInterval(() => this.scan(), this.pollMs);
    if (this.timer.unref) this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  scan() {
    try {
      const snapshot = this.buildSnapshot();
      this.snapshot = snapshot;
      this.emit('update', snapshot);
    } catch (error) {
      this.snapshot = { ...this.snapshot, ok: false, error: String(error?.message || error), updatedAt: Date.now() };
      this.emit('update', this.snapshot);
    }
  }

  listSessionFiles() {
    const files = [];
    let workspaces = [];
    try {
      workspaces = fs.readdirSync(this.sessionRoot, { withFileTypes: true });
    } catch {
      return files;
    }
    for (const workspace of workspaces) {
      if (!workspace.isDirectory()) continue;
      const workspacePath = path.join(this.sessionRoot, workspace.name);
      let sessions = [];
      try {
        sessions = fs.readdirSync(workspacePath, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const session of sessions) {
        if (!session.isDirectory()) continue;
        const sessionPath = path.join(workspacePath, session.name);
        let entries = [];
        try {
          entries = fs.readdirSync(sessionPath, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const entry of entries) {
          if (!entry.isFile()) continue;
          if (!/^session\..+\.(jsonl|zstd)$/i.test(entry.name)) continue;
          files.push(path.join(sessionPath, entry.name));
        }
      }
    }
    return files;
  }

  loadSession(file) {
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      return null;
    }
    const cached = this.cache.get(file);
    if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) return cached.value;
    let text;
    try {
      text = readSessionFile(file);
    } catch {
      return cached?.value || null;
    }
    const entries = parseEntries(text);
    const value = analyzeSession(file, stat, entries);
    this.cache.set(file, { size: stat.size, mtimeMs: stat.mtimeMs, value });
    return value;
  }

  buildSnapshot() {
    const files = this.listSessionFiles();
    const sessions = [];
    const seen = new Set(files);
    for (const file of files) {
      const session = this.loadSession(file);
      if (session) sessions.push(session);
    }
    for (const file of this.cache.keys()) if (!seen.has(file)) this.cache.delete(file);

    sessions.sort((a, b) => (b.lastEventTime || b.mtimeMs) - (a.lastEventTime || a.mtimeMs));
    const active = sessions[0] || null;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayMs = todayStart.getTime();
    const today = {
      tokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      calls: 0,
      sessions: 0,
      cacheHit: 0,
    };
    for (const session of sessions) {
      let counted = false;
      for (const sample of session.usageSamples) {
        if (sample.time < todayMs) continue;
        today.tokens += sample.totalTokens;
        today.inputTokens += sample.inputTokens;
        today.outputTokens += sample.outputTokens;
        today.cacheReadTokens += sample.cacheReadTokens;
        today.calls += 1;
        counted = true;
      }
      if (counted) today.sessions += 1;
    }
    today.cacheHit = (today.cacheReadTokens + today.inputTokens) > 0
      ? (today.cacheReadTokens / (today.cacheReadTokens + today.inputTokens)) * 100
      : 0;

    return {
      ok: true,
      sessions,
      active,
      today,
      updatedAt: Date.now(),
      dshHome: this.dshHome,
      error: '',
    };
  }
}

module.exports = {
  DshMonitor,
  decodeZstdFrames,
  analyzeSession,
};
