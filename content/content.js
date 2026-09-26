(() => {
  'use strict';

  const TRACK_LABEL = '커스텀 자막';
  const SETTINGS_KEY = 'settings';
  const DEFAULT_SETTINGS = { fontScale: 0.7 }; // 기본 크기(영상 높이의 5%) 대비 배율
  const BASE_FONT_RATIO = 0.05; // 브라우저 네이티브 자막의 기본 글자 크기와 동일

  const storageKey = (id) => `sub:${id}`;
  const tracks = new WeakMap(); // <video> -> 우리가 만든 TextTrack

  let current = { videoId: null, video: null, data: null };
  let settings = { ...DEFAULT_SETTINGS };
  let lastHref = null;
  let syncToken = 0;
  let observedPlayer = null;
  let playerObserver = null;

  // 타이밍은 TextTrack(mode=hidden)이 계산하고, 그리는 건 우리가 직접 한다.
  // 네이티브 자막 렌더링은 Edge/Windows 자막 설정이 CSS를 덮어쓸 수 있어서 크기·위치 제어가 불안정함.
  const overlay = document.createElement('div');
  overlay.className = 'ytsub-overlay';
  const resizeObserver = new ResizeObserver(updateFontSize);

  function getVideoId() {
    const url = new URL(location.href);
    if (url.pathname === '/watch') return url.searchParams.get('v');
    const m = url.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]{11})/);
    return m ? m[1] : null;
  }

  function findVideo() {
    if (!getVideoId()) return null;
    const scoped = location.pathname.startsWith('/shorts/')
      ? document.querySelector('#shorts-player video')
      : document.querySelector('#movie_player video');
    return scoped || document.querySelector('video.html5-main-video');
  }

  function getTrack(video) {
    let track = tracks.get(video);
    if (!track) {
      track = video.addTextTrack('subtitles', TRACK_LABEL, 'und');
      track.addEventListener('cuechange', () => {
        if (current.video === video) render();
      });
      tracks.set(video, track);
    }
    return track;
  }

  function isAdShowing(video) {
    const player = video.closest('.html5-video-player');
    return !!player && (player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting'));
  }

  function isEnabled() {
    return !!current.data && current.data.enabled !== false;
  }

  function render() {
    const { video } = current;
    const track = video && tracks.get(video);
    const visible = !!track && isEnabled() && !isAdShowing(video);

    overlay.style.display = visible ? '' : 'none';
    if (!visible) {
      overlay.replaceChildren();
      return;
    }

    const cues = [...(track.activeCues || [])].sort((a, b) => a.startTime - b.startTime);
    overlay.replaceChildren(...cues.map((cue) => {
      const line = document.createElement('div');
      const text = document.createElement('span');
      text.className = 'ytsub-cue';
      text.append(cue.getCueAsHTML()); // <i><b><u>만 살린 안전한 DOM 조각
      line.append(text);
      return line;
    }));
  }

  function updateFontSize() {
    const height = current.video?.clientHeight || 0;
    overlay.style.fontSize = `${Math.max(8, height * BASE_FONT_RATIO * settings.fontScale)}px`;
  }

  function applySettings(stored) {
    settings = { ...DEFAULT_SETTINGS, ...stored };
    updateFontSize();
  }

  function loadCues(video, data) {
    const track = getTrack(video);
    // mode가 disabled면 track.cues가 null이라 비울 수 없음
    track.mode = 'hidden';
    while (track.cues.length) track.removeCue(track.cues[0]);
    if (!data) return;

    const offset = Number(data.offset) || 0;
    for (const c of data.cues) {
      const start = c.s + offset;
      const end = c.e + offset;
      if (end <= 0) continue;
      track.addCue(new VTTCue(Math.max(0, start), end, c.t));
    }
  }

  // 오버레이를 플레이어 안에 두면 전체화면(플레이어 컨테이너가 fullscreen 됨)에서도 그대로 보임.
  // 광고 시작/종료, 컨트롤 바 표시 여부는 플레이어 class 변화로 감지.
  function attachToPlayer(video) {
    const player = video ? video.closest('.html5-video-player') : null;
    if (player && overlay.parentNode !== player) player.append(overlay);
    if (player === observedPlayer) return;

    playerObserver?.disconnect();
    observedPlayer = player;
    if (!player) {
      overlay.remove();
      return;
    }
    playerObserver = new MutationObserver(render);
    playerObserver.observe(player, { attributes: true, attributeFilter: ['class'] });
  }

  async function sync() {
    const token = ++syncToken;
    lastHref = location.href;
    const videoId = getVideoId();
    const video = findVideo();

    let data = null;
    if (videoId) {
      const key = storageKey(videoId);
      data = (await chrome.storage.local.get(key))[key] || null;
    }
    if (token !== syncToken) return; // 더 최신 sync가 시작됨

    if (current.video && current.video !== video) {
      const oldTrack = tracks.get(current.video);
      if (oldTrack) oldTrack.mode = 'disabled';
    }

    current = { videoId, video, data };
    resizeObserver.disconnect();
    if (video) {
      loadCues(video, data);
      tracks.get(video).mode = isEnabled() ? 'hidden' : 'disabled';
      resizeObserver.observe(video);
    }
    attachToPlayer(video);
    updateFontSize();
    render();
  }

  chrome.storage.local.get(SETTINGS_KEY).then((r) => applySettings(r[SETTINGS_KEY]));

  // 유튜브는 SPA라 페이지 이동 시 리로드가 없음
  document.addEventListener('yt-navigate-finish', sync);
  // 이벤트를 놓치거나 <video>/플레이어가 교체되는 경우를 위한 안전장치
  setInterval(() => {
    if (location.href !== lastHref || findVideo() !== current.video || (current.video && !overlay.isConnected)) sync();
  }, 1000);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (SETTINGS_KEY in changes) applySettings(changes[SETTINGS_KEY].newValue);
    if (current.videoId && storageKey(current.videoId) in changes) sync();
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== 'getStatus') return;
    sendResponse({
      videoId: getVideoId(),
      title: document.title.replace(/^\(\d+\)\s*/, '').replace(/\s*-\s*YouTube$/, ''),
      hasVideo: !!current.video,
    });
  });

  sync();
})();
