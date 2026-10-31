'use strict';

const api = window.petAPI;
const $ = (id) => document.getElementById(id);

const pet = $('pet');
const bubble = $('bubble');
const bubbleText = $('bubbleText');
const statusPill = $('statusPill');
const statusText = $('statusText');
const toast = $('toast');

const todayTokens = $('todayTokens');
const todayInput = $('todayInput');
const todayOutput = $('todayOutput');
const todayCalls = $('todayCalls');
const cacheHit = $('cacheHit');
const sessionTokens = $('sessionTokens');
const contextPercent = $('contextPercent');
const contextBar = $('contextBar');
const contextLabel = $('contextLabel');
const sessionTitle = $('sessionTitle');
const sessionMeta = $('sessionMeta');
const chipTokens = $('chipTokens');
const compactChip = $('compactChip');
const collapseBtn = $('collapseBtn');
const openDshBtn = $('openDshBtn');

const IDLE_SRC = '../assets/linhu.png';
const DRAG_SRC = '../assets/linhu.png';

let current = null;
let currentTone = 'idle';
let currentStatusKey = '';
let bubbleTimer = 0;
let hoverBubble = false;
let dragging = false;
let panelOpen = true;
let clickTimer = 0;
let lastPointerUp = 0;
let toastTimer = 0;

function formatTokens(value) {
  const n = Number(value) || 0;
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2).replace(/\.00$/, '') + 'B';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n >= 10_000_000 ? 1 : 2).replace(/\.0$/, '') + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(n >= 100_000 ? 0 : 1).replace(/\.0$/, '') + 'K';
  return String(Math.round(n));
}

function formatPercent(value) {
  const n = Number(value) || 0;
  if (n >= 10) return Math.round(n) + '%';
  if (n >= 1) return n.toFixed(1) + '%';
  return n.toFixed(1) + '%';
}

function formatCalls(value) {
  const n = Number(value) || 0;
  return n >= 10_000 ? formatTokens(n) : String(Math.round(n));
}

function setTone(tone) {
  if (currentTone === tone) return;
  currentTone = tone;
  document.body.classList.remove('tone-idle', 'tone-running', 'tone-waiting', 'tone-done', 'tone-failed');
  document.body.classList.add('tone-' + tone);
  statusPill.classList.remove('idle', 'running', 'waiting', 'done', 'failed');
  statusPill.classList.add(tone);
}

function showBubble(text, ms = 3600, tone) {
  if (!text) return;
  if (tone) {
    bubble.classList.remove('tone-running', 'tone-waiting', 'tone-done', 'tone-failed');
    if (tone !== 'idle') bubble.classList.add('tone-' + tone);
  }
  bubbleText.textContent = text;
  bubble.classList.add('show');
  clearTimeout(bubbleTimer);
  if (ms > 0) {
    bubbleTimer = setTimeout(() => {
      if (!hoverBubble && !dragging) bubble.classList.remove('show');
    }, ms);
  }
}

function hideBubble() {
  clearTimeout(bubbleTimer);
  if (!dragging) bubble.classList.remove('show');
}

function showToast(text, ms = 2200) {
  toast.textContent = text;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), ms);
}

function talk() {
  if (dragging) return;
  const active = current?.active;
  const status = active?.status || 'idle';
  const lines = {
    idle: ['摸鱼也要记得喝水呀～', '虎爷在呢，安心写吧。', '今天也要顺顺利利哦。', '要不要歇一会儿？'],
    thinking: ['别催别催，在想呢。', '这一步有点绕，让虎爷捋捋。'],
    running: ['在写了在写了！', '工具用得很顺手嘛。', '虎爷盯着呢，不会跑偏。'],
    tool: ['这个工具，咔嚓一下就好。', '正在替你跑命令，稍等～'],
    waiting: ['这里需要你点一下确认哦。', '虎爷停在这里等你呢。'],
    done: ['写完啦，快夸我！', '这轮收工，尾巴都翘起来了。'],
    failed: ['呜…要不要看看日志？', '出了点小状况，别慌。'],
  };
  const pool = lines[status] || lines.idle;
  showBubble(pool[Math.floor(Math.random() * pool.length)], 3600, active?.tone || 'idle');
}

function updateStats(snapshot) {
  current = snapshot;
  if (!snapshot || !snapshot.ok) {
    todayTokens.textContent = '--';
    todayInput.textContent = '--';
    todayOutput.textContent = '--';
    todayCalls.textContent = '0';
    cacheHit.textContent = '--';
    sessionTokens.textContent = '--';
    contextPercent.textContent = '--';
    contextBar.style.width = '0%';
    contextLabel.textContent = '0 / 1M';
    sessionTitle.textContent = '等待 DSH 数据…';
    sessionMeta.textContent = snapshot?.error || '先打开 DeepSeek Harness';
    chipTokens.textContent = '--';
    setTone('idle');
    statusText.textContent = '等待 DSH';
    return;
  }

  const today = snapshot.today || {};
  const active = snapshot.active;
  const tone = active?.tone || 'idle';
  setTone(tone);

  todayTokens.textContent = formatTokens(today.tokens);
  todayInput.textContent = formatTokens(today.inputTokens);
  todayOutput.textContent = formatTokens(today.outputTokens);
  todayCalls.textContent = formatCalls(today.calls);
  cacheHit.textContent = today.cacheHit > 0 ? formatPercent(today.cacheHit) : '--';
  chipTokens.textContent = formatTokens(today.tokens);

  if (!active) {
    sessionTokens.textContent = '0';
    contextPercent.textContent = '0%';
    contextBar.style.width = '0%';
    contextLabel.textContent = '0 / 1M';
    sessionTitle.textContent = '还没有 DSH 会话';
    sessionMeta.textContent = '打开 DeepSeek Harness 开始对话';
    statusText.textContent = '等待 DSH';
    return;
  }

  sessionTokens.textContent = formatTokens(active.totals?.totalTokens || 0);
  contextPercent.textContent = formatPercent(active.contextPercent);
  contextBar.style.width = Math.max(1.5, Math.min(100, active.contextPercent)) + '%';
  contextLabel.textContent = `${formatTokens(active.contextTokens)} / ${formatTokens(active.contextWindow)}`;
  sessionTitle.textContent = active.title || '未命名会话';
  sessionTitle.title = active.cwd || active.title || '';
  sessionMeta.textContent = `${active.model || 'deepseek'} · ${formatCalls(active.totals?.calls || 0)} 次调用`;
  statusText.textContent = active.detail || '打盹中';

  const statusKey = `${active.id}:${active.status}:${active.lastEventTime}`;
  if (statusKey !== currentStatusKey) {
    const initial = currentStatusKey === '';
    currentStatusKey = statusKey;
    if (!dragging) {
      showBubble(active.bubble || '虎爷在呢。', initial ? 5200 : 3600, tone);
    }
  }
}

async function refreshStats() {
  try {
    const snapshot = await api.getStats();
    updateStats(snapshot);
    return snapshot;
  } catch (error) {
    updateStats({ ok: false, error: '读取 DSH 数据失败' });
    return null;
  }
}

function setPetDragging(value) {
  dragging = value;
  document.body.classList.toggle('dragging', value);
  pet.src = value ? DRAG_SRC : IDLE_SRC;
  if (value) {
    clearTimeout(bubbleTimer);
    showBubble('哇啊——轻点轻点！', 0, 'running');
  } else {
    hideBubble();
    setTimeout(() => {
      if (!hoverBubble && !dragging) bubble.classList.remove('show');
    }, 1200);
  }
}

async function beginDrag(event) {
  if (event.button !== 0) return;
  if (event.target.closest('button, .compact-chip')) return;
  if (dragging) return;
  event.preventDefault();
  try { pet.setPointerCapture(event.pointerId); } catch {}
  setPetDragging(true);
  try {
    await api.dragStart();
  } catch {
    setPetDragging(false);
  }
}

async function finishDrag(event, cancelled = false) {
  if (!dragging) return;
  const moved = Boolean(event && event.detail?.moved);
  setPetDragging(false);
  try { await api.dragEnd(moved); } catch {}
  if (!cancelled) {
    document.body.classList.add('landing');
    setTimeout(() => document.body.classList.remove('landing'), 360);
  }
}

function handlePointerUp(event) {
  if (!dragging) return;
  const now = performance.now();
  const moved = Math.abs(event.screenX - dragStartX) > 4 || Math.abs(event.screenY - dragStartY) > 4;
  const quick = now - dragStartTime < 420;
  finishDrag({ detail: { moved } });
  if (!moved && quick) {
    if (now - lastPointerUp < 280) {
      clearTimeout(clickTimer);
      clickTimer = 0;
      togglePanel();
    } else {
      clearTimeout(clickTimer);
      clickTimer = setTimeout(() => {
        clickTimer = 0;
        talk();
      }, 250);
    }
  }
  lastPointerUp = now;
}

let dragStartX = 0;
let dragStartY = 0;
let dragStartTime = 0;

pet.addEventListener('pointerdown', (event) => {
  dragStartX = event.screenX;
  dragStartY = event.screenY;
  dragStartTime = performance.now();
  beginDrag(event);
});
pet.addEventListener('pointerup', handlePointerUp);
pet.addEventListener('pointercancel', (event) => finishDrag(event, true));
pet.addEventListener('lostpointercapture', () => {
  if (dragging) finishDrag(null, true);
});
pet.addEventListener('mouseenter', () => {
  hoverBubble = true;
  if (dragging) return;
  const active = current?.active;
  showBubble(active?.bubble || '拖我去你想放的地方吧～', 0, active?.tone || 'idle');
});
pet.addEventListener('mouseleave', () => {
  hoverBubble = false;
  if (!dragging) {
    setTimeout(() => {
      if (!hoverBubble && !dragging) bubble.classList.remove('show');
    }, 700);
  }
});

window.addEventListener('blur', () => {
  if (dragging) finishDrag(null, true);
});

async function togglePanel(force) {
  const open = typeof force === 'boolean' ? force : !panelOpen;
  if (open === panelOpen) return;
  panelOpen = open;
  document.body.classList.toggle('panel-closed', !open);
  collapseBtn.textContent = open ? '⌄' : '⌃';
  try {
    await api.setPanelOpen(open);
  } catch {}
}

collapseBtn.addEventListener('click', (event) => {
  event.stopPropagation();
  togglePanel(false);
});
compactChip.addEventListener('click', (event) => {
  event.stopPropagation();
  togglePanel(true);
});
openDshBtn.addEventListener('click', async (event) => {
  event.stopPropagation();
  try {
    const result = await api.openDsh();
    if (result?.ok) showToast(result.focused ? '已切到 DeepSeek Harness' : '已打开 DeepSeek Harness');
    else showToast(result?.error || '没有找到正在运行的 DSH');
  } catch {
    showToast('打开 DSH 失败');
  }
});

window.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  api.showContextMenu();
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') togglePanel(false);
});

api.onStats(updateStats);
api.onPanel((open) => {
  panelOpen = open;
  document.body.classList.toggle('panel-closed', !open);
  collapseBtn.textContent = open ? '⌄' : '⌃';
});
refreshStats();
api.getState().then((state) => {
  if (typeof state?.panelOpen === 'boolean') {
    panelOpen = state.panelOpen;
    document.body.classList.toggle('panel-closed', !panelOpen);
    collapseBtn.textContent = panelOpen ? '⌄' : '⌃';
  }
});

// Small hook used by the local screenshot/smoke-test mode.
window.__linhuTest = {
  setDragging(value) { setPetDragging(Boolean(value)); },
  togglePanel(value) { return togglePanel(value); },
};
