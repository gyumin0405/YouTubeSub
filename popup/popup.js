'use strict';

const $ = (sel) => document.querySelector(sel);
const storageKey = (id) => `sub:${id}`;
const SETTINGS_KEY = 'settings';
const DEFAULT_FONT_SCALE = 0.7;

let videoId = null;
let videoTitle = null;
let entry = null;
let subEntries = [];

function showNotice(text) {
  $('#notice').textContent = text;
  $('#notice').hidden = !text;
}

function showError(text) {
  $('#error').textContent = text || '';
  $('#error').hidden = !text;
}

function render() {
  $('#controls').hidden = !entry;
  $('#current').textContent = entry ? `${entry.name} · ${entry.cues.length}줄` : '없음';
  if (entry) {
    $('#offset').value = entry.offset ?? 0;
    $('#enabled').checked = entry.enabled !== false;
  }
}

async function save(patch) {
  entry = { ...entry, ...patch };
  await chrome.storage.local.set({ [storageKey(videoId)]: entry });
  render();
  renderSubList();
}

async function renderSubList() {
  const all = await chrome.storage.local.get(null);
  subEntries = Object.entries(all)
    .filter(([key]) => key.startsWith('sub:'))
    .map(([key, value]) => ({ id: key.slice(4), ...value }))
    .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));

  filterSubList();
}

function filterSubList() {
  const query = $('#subSearch').value.trim().toLowerCase();
  const entries = query
    ? subEntries.filter((e) => `${e.videoTitle || ''} ${e.name || ''}`.toLowerCase().includes(query))
    : subEntries;

  const list = $('#subList');
  list.replaceChildren();
  $('#subListEmpty').hidden = entries.length > 0;
  $('#subListEmpty').textContent = subEntries.length ? '검색 결과가 없습니다.' : '등록된 자막이 없습니다.';

  for (const e of entries) {
    const li = document.createElement('li');
    li.className = 'sub-item';
    if (e.id === videoId) li.classList.add('current');

    const info = document.createElement('div');
    info.className = 'sub-item-info';

    const title = document.createElement('div');
    title.className = 'sub-item-title';
    title.textContent = e.videoTitle || e.id;
    title.title = e.videoTitle || e.id;

    const meta = document.createElement('div');
    meta.className = 'muted';
    meta.textContent = `${e.name} · ${e.cues?.length ?? 0}줄`;

    info.append(title, meta);

    const delBtn = document.createElement('button');
    delBtn.className = 'danger small';
    delBtn.textContent = '삭제';
    delBtn.addEventListener('click', () => deleteEntry(e.id));

    li.append(info, delBtn);
    list.append(li);
  }
}

async function deleteEntry(id) {
  await chrome.storage.local.remove(storageKey(id));
  if (id === videoId) {
    entry = null;
    render();
  }
  renderSubList();
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let status = null;
  try {
    status = await chrome.tabs.sendMessage(tab.id, { type: 'getStatus' });
  } catch {
    // 유튜브 탭이 아니거나, 확장 설치 전에 열린 탭이라 content script가 없음
  }

  if (!status) {
    showNotice('유튜브 영상 탭에서 열면 자막을 등록할 수 있습니다. 아래에서 기존에 등록한 자막을 확인·삭제할 수 있습니다.');
  } else if (!status.videoId) {
    showNotice('영상 재생 페이지가 아닙니다. 아래에서 기존에 등록한 자막을 확인·삭제할 수 있습니다.');
  } else {
    videoId = status.videoId;
    videoTitle = status.title;
    $('#title').textContent = status.title;
    $('#title').title = status.title;
    $('#videoId').textContent = videoId;
    $('#videoSection').hidden = false;

    const key = storageKey(videoId);
    entry = (await chrome.storage.local.get(key))[key] || null;
    render();
  }

  const settings = (await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY] || {};
  renderFontScale(settings.fontScale ?? DEFAULT_FONT_SCALE);
  renderSubList();
}

function renderFontScale(scale) {
  const pct = Math.round(scale * 100);
  $('#fontScale').value = pct;
  $('#fontScaleValue').textContent = `${pct}%`;
}

async function saveFontScale(scale) {
  const settings = (await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY] || {};
  await chrome.storage.local.set({ [SETTINGS_KEY]: { ...settings, fontScale: scale } });
}

$('#fontScale').addEventListener('input', (e) => {
  const scale = Number(e.target.value) / 100;
  renderFontScale(scale);
  saveFontScale(scale); // 드래그하는 동안 영상에 바로 반영
});

$('#fontScaleReset').addEventListener('click', () => {
  renderFontScale(DEFAULT_FONT_SCALE);
  saveFontScale(DEFAULT_FONT_SCALE);
});

$('#file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  showError('');
  try {
    const cues = parseSubtitles(decodeSubtitle(await file.arrayBuffer()));
    if (!cues.length) return showError('자막을 찾지 못했습니다. SRT/VTT 형식인지 확인하세요.');
    await save({ name: file.name, cues, offset: entry?.offset ?? 0, enabled: true, savedAt: Date.now(), videoTitle });
  } catch (err) {
    showError(`불러오기 실패: ${err.message}`);
  }
});

function setOffset(value) {
  save({ offset: Math.round(value * 100) / 100 });
}

document.querySelectorAll('[data-step]').forEach((btn) => {
  btn.addEventListener('click', () => setOffset((entry.offset || 0) + Number(btn.dataset.step)));
});

$('#offset').addEventListener('change', (e) => {
  const v = Number(e.target.value);
  if (Number.isFinite(v)) setOffset(v);
});

$('#enabled').addEventListener('change', (e) => save({ enabled: e.target.checked }));

$('#subSearch').addEventListener('input', filterSubList);

$('#delete').addEventListener('click', async () => {
  await chrome.storage.local.remove(storageKey(videoId));
  entry = null;
  render();
  renderSubList();
});

init();
