'use strict';

// 한국어 SRT는 CP949(EUC-KR)로 저장된 경우가 많아서 UTF-8 실패 시 폴백
function decodeSubtitle(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(buffer);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(buffer);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('euc-kr').decode(buffer);
  }
}

// "01:02:03,456" / "02:03.456" / "1:02:03.5" → 초
function parseTime(str) {
  const m = str.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})$/);
  if (!m) return null;
  const [, h = '0', min, sec, frac] = m;
  return Number(h) * 3600 + Number(min) * 60 + Number(sec) + Number(frac.padEnd(3, '0')) / 1000;
}

function cleanText(text) {
  return text
    .replace(/\{\\[^}]*\}/g, '')                 // ASS 오버라이드 태그 {\an8} 등
    .replace(/<(?!\/?[ibu]>)[^>]*>/gi, '')       // <i><b><u> 외 태그(<font> 등) 제거
    .trim();
}

// SRT와 WebVTT 모두 처리: "-->"가 있는 줄을 타이밍 줄로 보고 그 다음 줄들을 텍스트로 취급
function parseSubtitles(text) {
  const lines = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  const cues = [];

  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes('-->')) continue;
    const [left, right] = lines[i].split('-->');
    const s = parseTime(left);
    const e = parseTime(right.trim().split(/\s+/)[0] || '');
    if (s == null || e == null) continue;

    const body = [];
    while (i + 1 < lines.length && lines[i + 1].trim() !== '' && !lines[i + 1].includes('-->')) {
      body.push(lines[++i]);
    }
    const t = cleanText(body.join('\n'));
    if (t && e > s) cues.push({ s, e, t });
  }

  return cues.sort((a, b) => a.s - b.s);
}
