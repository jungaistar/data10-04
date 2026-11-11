/* 개발장비 외관평가 Agent — 순수 로직 (화면·저장소와 무관)
   브라우저에서는 window.ExtLogic, node 에서는 require('./logic.js') 로 씁니다.
   기준 문서: docs/01_프로젝트_기획서.md (3장 데이터, 5장 기능, 8장 1단계)

   흐름: 체크시트 엑셀 → parseChecklist(열 찾기·항목) ┐
         이슈 리스트 엑셀 → parseIssues(열 찾기·이슈)  ├→ matchAll(이슈 → 체크 항목 잇기: 부위 이름 맞추기 + 유형 낱말 사전)
         모델 정보 시트 → parseModels(기종·크기·신규 부품) ┘
         → scoreItems(항목별 빈도·최근성·심각도 점수, 모델 특성 거르기·닮은 정도 반영)
         → optimizeChecklist(신규 개발모델용 체크시트: 중점·일반·생략 후보 + 신규 항목 후보)
         → buildReport(이슈 발생 우려 포인트) · buildAiPromptInfo(모델 이름 별칭 가리기) */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ExtLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  /* 판(版) — index.html 의 ?v= · app.js 의 APP_VERSION 과 같아야 합니다(scripts/bump-version.mjs 로 함께 올림).
     브라우저가 옛 logic.js 와 새 app.js 를 섞어 쓰면 app.js 가 이 값을 보고 계산을 멈춥니다. */
  var VERSION = '2026-11-11.6';

  var SCHEMA_VERSION = 1;

  /* ── 1. 기본 글자 다루기 ───────────────────────────────────── */
  function str(v) { return v == null ? '' : String(v).trim(); }
  /* 비교용 — 공백·괄호·가운데점·마침표·밑줄·붙임표·빗금을 빼고 소문자로 */
  function norm(s) { return str(s).replace(/[\s()（）\[\]·.:_\-/]/g, '').toLowerCase(); }
  function uniq(a) { var s = {}, o = []; a.forEach(function (x) { if (!s[x]) { s[x] = 1; o.push(x); } }); return o; }
  function round(v, d) { var m = Math.pow(10, d || 0); return Math.round(v * m) / m; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function colName(i) {
    var s = ''; i = Number(i);
    do { s = String.fromCharCode(65 + (i % 26)) + s; i = Math.floor(i / 26) - 1; } while (i >= 0);
    return s;
  }
  /* 날짜 → 'YYYY-MM-DD'. Date · 엑셀 일련번호 · '2026-03-05' · '2026.3.5' · '2026/03/05' · '20260305' */
  function toISO(v) {
    if (v == null || v === '') return '';
    if (v instanceof Date) return isNaN(v) ? '' : v.getFullYear() + '-' + pad(v.getMonth() + 1) + '-' + pad(v.getDate());
    if (typeof v === 'number' && isFinite(v)) {
      if (v > 19000000 && v < 21000000) return toISO(String(Math.round(v)));
      if (v < 20000 || v > 80000) return '';
      var d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
      return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
    }
    var s = str(v), m = /^(\d{4})[-./년\s]+(\d{1,2})[-./월\s]+(\d{1,2})/.exec(s);
    if (!m) m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
    if (!m) return '';
    var y = +m[1], mo = +m[2], da = +m[3];
    if (mo < 1 || mo > 12 || da < 1 || da > 31) return '';
    return y + '-' + pad(mo) + '-' + pad(da);
  }
  function daysBetween(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000); }

  /* 심각도 → 상·중·하 (A/B/C, High/Medium/Low, 중대·경미 등). 빈칸은 '' */
  function normSeverity(v) {
    var s = norm(v);
    if (!s) return '';
    if (/^(상|a|high|h|중대|심각|치명|critical|1|대)$/.test(s)) return '상';
    if (/^(중|b|medium|mid|m|보통|일반|2)$/.test(s)) return '중';
    if (/^(하|c|low|l|경미|미미|minor|3|소)$/.test(s)) return '하';
    if (/중대|심각|치명/.test(s)) return '상';
    if (/경미/.test(s)) return '하';
    return '';
  }
  /* 예/아니오 → true/false, 모르면 null. 「신규」「Y」「O」「적용」 = 예 */
  function normYN(v) {
    if (v === true || v === false) return v;
    var s = norm(v);
    if (!s) return null;
    if (/^(y|yes|예|네|o|○|●|있음|유|신규|적용|true|1|v|✓)$/.test(s)) return true;
    if (/^(n|no|아니오|아니요|x|×|없음|무|기존|미적용|false|0|-)$/.test(s)) return false;
    if (/신규/.test(s)) return true;
    if (/기존|없/.test(s)) return false;
    return null;
  }

  /* ── 2. 점검 유형과 낱말 사전 ──────────────────────────────── */
  var TYPES = ['도장', '실링', '간섭', '단차·갭', '데칼·표시', '찍힘·손상', '체결', '녹·부식'];
  var DEFAULT_TYPE_KEYWORDS = {
    '도장': ['도장', '페인트', '도막', '흐름', '흘러내림', '오렌지필', '색상', '색차', '광택', '박리', '기포', '핀홀', '미도장', '얼룩'],
    '실링': ['실링', '실러', '실란트', '누수', '물샘', '빗물', '방수', '패킹', '웨더스트립', '씰'],
    '간섭': ['간섭', '닿음', '맞닿', '접촉', '쓸림', '마찰', '걸림'],
    '단차·갭': ['단차', '갭', '틈새', '유격', '어긋남', '벌어짐', '정렬'],
    '데칼·표시': ['데칼', '스티커', '라벨', '명판', '표시', '들뜸', '주름'],
    '찍힘·손상': ['찍힘', '스크래치', '긁힘', '파손', '변형', '덴트', '깨짐', '크랙'],
    '체결': ['볼트', '너트', '체결', '풀림', '토크', '클램프', '마킹', '잠금'],
    '녹·부식': ['녹', '부식', '발청']
  };
  /* 부위 이름 — 대표 이름 : 다르게 적는 이름들. 설정에서 고칠 수 있습니다 */
  var DEFAULT_PART_SYNONYMS = {
    '캡': ['CAB', '캐빈', '운전실', '캡 외판'],
    '캡도어': ['캡 도어', '도어', 'DOOR', '운전실 도어'],
    '캡유리': ['캡 유리', '유리', '글라스', 'GLASS', '윈도우', '앞유리'],
    '붐': ['BOOM'],
    '암': ['ARM'],
    '버킷': ['BUCKET', '바켓'],
    '카운터웨이트': ['카운터 웨이트', 'C/W', 'CWT', 'COUNTERWEIGHT', 'COUNTER WEIGHT'],
    '엔진후드': ['엔진 후드', '후드', 'HOOD', '엔진커버', '엔진 커버'],
    '사이드커버': ['사이드 커버', '측면커버', '측면 커버', 'SIDE COVER'],
    '연료탱크': ['연료 탱크', 'FUEL TANK'],
    '작동유탱크': ['작동유 탱크', '유압탱크', '유압 탱크', 'HYD TANK'],
    '핸드레일': ['핸드 레일', '손잡이', 'HANDRAIL'],
    '스텝': ['발판', 'STEP'],
    '상부프레임': ['상부 프레임', '어퍼프레임', 'UPPER FRAME'],
    '미러': ['사이드미러', '거울', 'MIRROR'],
    '공구함': ['공구 함', '툴박스', 'TOOL BOX', 'TOOLBOX'],
    '배터리커버': ['배터리 커버', 'BATTERY COVER']
  };
  /* 위치 낱말 — 「붐 LH」「캡(좌측)」은 같은 부위로 봅니다 */
  var POSITION_WORDS = ['lh', 'rh', '좌', '우', '좌측', '우측', '전', '후', '전방', '후방', '전면', '후면', '앞', '뒤', '상단', '하단', '좌우'];

  function partLookup(synonyms) {
    var map = {};
    Object.keys(synonyms || {}).forEach(function (c) {
      map[norm(c)] = c;
      (synonyms[c] || []).forEach(function (a) { if (norm(a) && !map[norm(a)]) map[norm(a)] = c; });
    });
    return map;
  }
  var lookupCache = { src: null, map: null };
  function lookupFor(synonyms) {
    if (lookupCache.src !== synonyms) { lookupCache = { src: synonyms, map: partLookup(synonyms) }; }
    return lookupCache.map;
  }
  /* 부위 이름 맞추기 — 대표 이름을 돌려줍니다. 사전에 없으면 공백·위치 낱말을 뺀 이름 그대로 */
  function partOf(raw, synonyms) {
    var lk = lookupFor(synonyms || DEFAULT_PART_SYNONYMS);
    var s = str(raw);
    if (!s) return '';
    if (lk[norm(s)]) return lk[norm(s)];
    var noParen = s.replace(/[(（\[][^)）\]]*[)）\]]?/g, ' ').trim();
    if (lk[norm(noParen)]) return lk[norm(noParen)];
    var toks = noParen.split(/[\s,]+/).filter(function (t) { return t && POSITION_WORDS.indexOf(t.toLowerCase()) < 0; });
    var joined = toks.join(' ');
    if (lk[norm(joined)]) return lk[norm(joined)];
    var cut = norm(joined).replace(/(lh|rh|좌측|우측)$/, '');
    if (lk[cut]) return lk[cut];
    return (toks.join('') || noParen.replace(/\s+/g, '') || s.replace(/\s+/g, '')).toUpperCase();
  }

  /* 글에서 점검 유형 찾기 — 유형별로 들어 있는 낱말 수를 세어 가장 많은 유형. 같으면 TYPES 순서 */
  function detectType(text, keywords) {
    var kw = keywords || DEFAULT_TYPE_KEYWORDS, s = str(text).toLowerCase();
    var best = '', bestN = 0, hits = [];
    typeList(kw).forEach(function (t) {
      var found = (kw[t] || []).filter(function (w) { return w && s.indexOf(String(w).toLowerCase()) >= 0; });
      if (found.length > bestN) { best = t; bestN = found.length; hits = found; }
    });
    return { type: best, hits: hits };
  }
  function typeList(kw) { var extra = Object.keys(kw || {}).filter(function (t) { return TYPES.indexOf(t) < 0; }); return TYPES.filter(function (t) { return kw && kw[t]; }).concat(extra); }
  /* 엑셀 「유형」 칸 값을 유형 이름으로 — 유형 이름과 같거나, 그 유형 낱말이 들어 있으면 */
  function typeFromLabel(label, keywords) {
    var kw = keywords || DEFAULT_TYPE_KEYWORDS, n = norm(label);
    if (!n) return '';
    var list = typeList(kw);
    for (var i = 0; i < list.length; i++) {
      var parts = list[i].split('·').map(norm);
      if (norm(list[i]) === n || parts.indexOf(n) >= 0) return list[i];
    }
    return detectType(label, kw).type;
  }
  /* 겹침 계산용 낱말 — 두 글자 이상, 흔한 말은 뺌 */
  var STOP = ['불량', '발생', '확인', '부위', '상태', '점검', '여부', '이상', '없음', '없을', '기준', '외관', '육안', '있음', '관련', '부분', '전체', '이내', '이하'];
  function words(text) {
    return uniq(str(text).split(/[^0-9A-Za-z가-힣]+/).filter(function (w) { return w.length >= 2 && STOP.indexOf(w) < 0; }));
  }

  /* ── 3. 열 찾기 (가져오기) ─────────────────────────────────── */
  var CHECK_FIELDS = [
    { id: 'no', label: '번호', req: false, aliases: ['no', '번호', '순번', '항목번호', '체크번호'] },
    { id: 'part', label: '부위', req: true, aliases: ['부위', '부위명', '부품', '부품명', '검사부위', '점검부위', '위치', 'part'] },
    { id: 'item', label: '점검 항목', req: true, aliases: ['점검항목', '검사항목', '항목', '체크항목', '검사내용', '점검내용', '확인항목', 'checkitem'] },
    { id: 'method', label: '검사 방법', req: false, aliases: ['검사방법', '점검방법', '방법', '측정방법', '확인방법'] },
    { id: 'criteria', label: '판정 기준', req: false, aliases: ['판정기준', '기준', '검사기준', '합격기준', '규격'] },
    { id: 'category', label: '점검 유형', req: false, aliases: ['점검유형', '유형', '구분', '분류', '항목구분', '검사유형'] },
    { id: 'required', label: '필수(생략 금지)', req: false, aliases: ['필수', '필수항목', '법규', '안전', '생략금지'] }
  ];
  var ISSUE_FIELDS = [
    { id: 'no', label: '이슈 번호', req: false, aliases: ['no', '번호', '이슈번호', '관리번호', '순번', 'issueno'] },
    { id: 'model', label: '모델', req: true, aliases: ['모델', '모델명', '기종명', '개발모델', '장비', '장비모델', 'model'] },
    { id: 'date', label: '발생일', req: false, aliases: ['발생일', '발생일자', '일자', '날짜', '발견일', '등록일', '평가일'] },
    { id: 'part', label: '부위', req: true, aliases: ['부위', '부위명', '부품', '부품명', '발생부위', '위치', 'part'] },
    { id: 'content', label: '이슈 내용', req: true, aliases: ['이슈내용', '내용', '이슈', '불량내용', '현상', '문제점', '지적사항', '이슈사항'] },
    { id: 'type', label: '이슈 유형', req: false, aliases: ['이슈유형', '유형', '불량유형', '구분', '분류'] },
    { id: 'severity', label: '심각도', req: false, aliases: ['심각도', '등급', '중요도', '레벨', '심각성', 'grade'] },
    { id: 'action', label: '조치 내용', req: false, aliases: ['조치', '조치내용', '대책', '조치사항', '개선내용'] }
  ];
  var MODEL_FIELDS = [
    { id: 'model', label: '모델', req: true, aliases: ['모델', '모델명', '개발모델', 'model'] },
    { id: 'kind', label: '기종', req: false, aliases: ['기종', '장비종류', '차종', '종류'] },
    { id: 'size', label: '크기', req: false, aliases: ['크기', '톤급', '등급', '사이즈', '클래스', '규격'] },
    { id: 'newParts', label: '신규 부품', req: false, aliases: ['신규부품', '신규부품여부', '신규', '신규부품적용', '신규적용'] },
    { id: 'note', label: '비고', req: false, aliases: ['비고', '메모', '신규부품내용', '설명'] }
  ];
  var FIELD_SETS = { checklist: CHECK_FIELDS, issues: ISSUE_FIELDS, models: MODEL_FIELDS };

  function matchField(fields, text) {
    var n = norm(text);
    if (!n) return null;
    for (var i = 0; i < fields.length; i++) if (fields[i].aliases.indexOf(n) >= 0) return fields[i].id;
    return null;
  }
  /* aoa: 시트를 행 배열로(SheetJS header:1). kind: checklist | issues | models
     반환 { headerRow, map:{field:col}, headers:[글자], missing:[field], warnings:[], score } */
  function detectColumns(aoa, kind, overrides) {
    var fields = FIELD_SETS[kind], byId = {};
    fields.forEach(function (f) { byId[f.id] = f; });
    var best = -1, bestScore = 0, anyRow = -1, anyScore = 0, limit = Math.min(aoa.length, 20);
    for (var r = 0; r < limit; r++) {
      var row = aoa[r] || [], seen = {}, score = 0;
      for (var c = 0; c < row.length; c++) {
        var f = matchField(fields, row[c]);
        if (f && !seen[f]) { seen[f] = 1; score++; }
      }
      var anchor = kind === 'checklist' ? (seen.part && seen.item) : kind === 'issues' ? (seen.model && (seen.part || seen.content)) : (seen.model && (seen.kind || seen.size || seen.newParts));
      if (anchor && score > bestScore) { best = r; bestScore = score; }
      if (score > anyScore) { anyRow = r; anyScore = score; }
    }
    // 꼭 맞는 머리행이 없으면 이름이 가장 많이 맞는 행을 머리행으로 보고, 나머지는 열 연결에서 고르게 합니다
    var weak = best < 0 && anyRow >= 0;
    if (weak) { best = anyRow; bestScore = anyScore; }
    var out = { headerRow: best, map: {}, headers: [], missing: [], warnings: [], score: bestScore };
    if (best < 0 || weak) {
      out.warnings.push(kind === 'checklist' ? '머리행(부위·점검 항목 …)을 찾지 못했습니다. 체크시트 시트인지 확인하거나 아래에서 열을 직접 골라 주세요.'
        : kind === 'issues' ? '머리행(모델·부위·이슈 내용 …)을 찾지 못했습니다. 이슈 리스트 시트인지 확인하거나 아래에서 열을 직접 골라 주세요.'
          : '모델 정보 머리행을 찾지 못했습니다.');
      if (best < 0) out.headerRow = 0;
    }
    var hdr = aoa[out.headerRow] || [], width = hdr.length;
    for (var k = out.headerRow; k < Math.min(aoa.length, out.headerRow + 5); k++) width = Math.max(width, (aoa[k] || []).length);
    for (var c3 = 0; c3 < width; c3++) {
      var text = str(hdr[c3]);
      out.headers.push(text);
      if (best < 0) continue;
      var fid = matchField(fields, text);
      if (fid && out.map[fid] == null) out.map[fid] = c3;
      else if (fid) out.warnings.push('「' + text + '」 열이 두 번 나옵니다. 앞의 것(' + colName(out.map[fid]) + ')을 씁니다.');
    }
    if (overrides) Object.keys(overrides).forEach(function (fid) {
      if (!byId[fid]) return;
      var v = overrides[fid];
      if (v === -1 || v === '' || v == null || Number(v) < 0) delete out.map[fid]; else out.map[fid] = Number(v);
    });
    fields.forEach(function (f) { if (f.req && out.map[f.id] == null) out.missing.push(f.id); });
    if (out.missing.length) out.warnings.push('꼭 필요한 열이 없습니다: ' + out.missing.map(function (id) { return byId[id].label; }).join(', ') + ' — 열 연결에서 골라 주세요.');
    return out;
  }
  function headerSignature(det) { return det && det.headers ? det.headers.map(norm).join('|') : ''; }
  function cell(row, map, id) { return map[id] == null ? null : row[map[id]]; }

  /* 체크시트 시트 → 항목 목록. 유형 칸이 없거나 비면 항목 글로 유형을 추정합니다 */
  function parseChecklist(aoa, opts) {
    opts = opts || {};
    var det = detectColumns(aoa, 'checklist', opts.overrides), items = [], warnings = [];
    if (det.missing.length) return { det: det, items: items, warnings: warnings };
    var lastPart = '';
    for (var r = det.headerRow + 1; r < aoa.length; r++) {
      var row = aoa[r] || [];
      var part = str(cell(row, det.map, 'part')), item = str(cell(row, det.map, 'item'));
      if (!item) continue;
      if (!part) { part = lastPart; if (part) warnings.push({ row: r + 1, msg: '부위가 비어 있어 위 행의 「' + part + '」으로 봅니다(병합 칸).' }); }
      if (!part) { warnings.push({ row: r + 1, msg: '부위가 없어 건너뜁니다.' }); continue; }
      lastPart = part;
      var catRaw = str(cell(row, det.map, 'category'));
      var cat = catRaw ? typeFromLabel(catRaw, opts.keywords) : '';
      var guessed = false;
      if (!cat) { cat = detectType(item + ' ' + str(cell(row, det.map, 'criteria')), opts.keywords).type; guessed = !!cat; }
      if (catRaw && !typeFromLabel(catRaw, opts.keywords)) warnings.push({ row: r + 1, msg: '유형 「' + catRaw + '」을 알 수 없어 항목 글로 추정했습니다' + (cat ? '(' + cat + ').' : '(못 찾음).') });
      items.push({
        no: str(cell(row, det.map, 'no')), part: part, item: item, method: str(cell(row, det.map, 'method')), criteria: str(cell(row, det.map, 'criteria')),
        category: cat || '', guessed: guessed, required: normYN(cell(row, det.map, 'required')) === true, row: r + 1
      });
    }
    return { det: det, items: items, warnings: warnings };
  }

  /* 이슈 리스트 시트 → 이슈 목록 */
  function parseIssues(aoa, opts) {
    opts = opts || {};
    var det = detectColumns(aoa, 'issues', opts.overrides), issues = [], warnings = [];
    if (det.missing.length) return { det: det, issues: issues, warnings: warnings };
    for (var r = det.headerRow + 1; r < aoa.length; r++) {
      var row = aoa[r] || [];
      var model = str(cell(row, det.map, 'model')), part = str(cell(row, det.map, 'part')), content = str(cell(row, det.map, 'content'));
      if (!model && !part && !content) continue;
      if (!content && !part) { warnings.push({ row: r + 1, msg: '부위·내용이 모두 비어 건너뜁니다.' }); continue; }
      if (!model) warnings.push({ row: r + 1, msg: '모델이 비어 있습니다(「모델 미상」으로 둡니다).' });
      var dRaw = cell(row, det.map, 'date'), date = toISO(dRaw);
      if (det.map.date != null && dRaw != null && dRaw !== '' && !date) warnings.push({ row: r + 1, msg: '발생일 「' + str(dRaw) + '」을 날짜로 읽지 못했습니다.' });
      var sRaw = cell(row, det.map, 'severity'), sev = normSeverity(sRaw);
      if (str(sRaw) && !sev) warnings.push({ row: r + 1, msg: '심각도 「' + str(sRaw) + '」을 상·중·하로 읽지 못해 「중」으로 봅니다.' });
      issues.push({
        no: str(cell(row, det.map, 'no')), model: model || '모델 미상', date: date, part: part, content: content,
        typeLabel: str(cell(row, det.map, 'type')), severity: sev || '중', sevGiven: !!sev, action: str(cell(row, det.map, 'action')),
        file: opts.fileName || '', row: r + 1
      });
    }
    return { det: det, issues: issues, warnings: warnings };
  }

  /* 모델 정보 시트 → { 모델이름: {kind,size,newParts,note} } */
  function parseModels(aoa) {
    var det = detectColumns(aoa, 'models'), models = {};
    if (det.missing.length || det.score < 2) return { det: det, models: models, found: false };
    for (var r = det.headerRow + 1; r < aoa.length; r++) {
      var row = aoa[r] || [], m = str(cell(row, det.map, 'model'));
      if (!m) continue;
      models[m] = { kind: str(cell(row, det.map, 'kind')), size: str(cell(row, det.map, 'size')), newParts: normYN(cell(row, det.map, 'newParts')), note: str(cell(row, det.map, 'note')) };
    }
    return { det: det, models: models, found: Object.keys(models).length > 0 };
  }
  /* 통합문서에서 그 종류에 가장 맞는 시트 */
  function pickSheet(sheets, kind) {
    var best = null, bestScore = -1;
    (sheets || []).forEach(function (s) {
      var d = detectColumns(s.aoa || [], kind);
      var sc = d.missing.length ? -1 : d.score;
      if (sc > bestScore) { best = s; bestScore = sc; }
    });
    return bestScore >= 0 ? best : null;
  }

  /* ── 4. 쌓기 ──────────────────────────────────────────────── */
  function itemKey(it, syn) { return norm(partOf(it.part, syn)) + '|' + norm(it.item); }
  function nextId(list, prefix, width) {
    var max = 0;
    list.forEach(function (x) { var m = new RegExp('^' + prefix + '(\\d+)$').exec(x.id || ''); if (m) max = Math.max(max, +m[1]); });
    return function () { max++; var s = String(max); while (s.length < width) s = '0' + s; return prefix + s; };
  }
  /* 체크시트 반영 — replace: 새 파일이 기준(없어진 항목은 뺌), add: 기존에 더함. 같은 부위+항목은 같은 id 를 유지 */
  function mergeChecklist(existing, incoming, mode, syn) {
    var byKey = {}, stat = { added: 0, updated: 0, removed: 0 };
    (existing || []).forEach(function (it) { byKey[itemKey(it, syn)] = it; });
    var gen = nextId(existing || [], 'C', 3), out = [], seen = {};
    incoming.forEach(function (it) {
      var k = itemKey(it, syn);
      if (seen[k]) return;
      seen[k] = 1;
      var old = byKey[k];
      var nu = { id: old ? old.id : gen(), no: it.no, part: it.part, item: it.item, method: it.method, criteria: it.criteria, category: it.category, guessed: !!it.guessed, required: !!it.required, added: false };
      if (old) stat.updated++; else stat.added++;
      out.push(nu);
    });
    if (mode === 'add') {
      (existing || []).forEach(function (it) { if (!seen[itemKey(it, syn)]) out.unshift(it); });
      // 기존 순서 유지 + 새 항목은 뒤에
      var exIds = (existing || []).map(function (x) { return x.id; });
      out.sort(function (a, b) { var ia = exIds.indexOf(a.id), ib = exIds.indexOf(b.id); return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib); });
    } else {
      (existing || []).forEach(function (it) { if (!seen[itemKey(it, syn)]) stat.removed++; });
    }
    return { items: out, stat: stat };
  }
  function issueKey(is, syn) { return [norm(is.model), is.date, norm(partOf(is.part, syn)), norm(is.content)].join('|'); }
  /* 이슈 반영 — 같은 (모델·발생일·부위·내용) 은 한 건. 다시 넣으면 심각도·유형·조치만 바뀝니다 */
  function mergeIssues(existing, incoming, syn) {
    var byKey = {}, stat = { added: 0, updated: 0, same: 0 };
    var out = (existing || []).slice();
    out.forEach(function (is, i) { byKey[issueKey(is, syn)] = i; });
    var gen = nextId(existing || [], 'I', 4);
    incoming.forEach(function (is) {
      var k = issueKey(is, syn);
      if (byKey[k] != null) {
        var old = out[byKey[k]];
        var changed = old.severity !== is.severity || old.typeLabel !== is.typeLabel || old.action !== is.action || old.no !== is.no;
        out[byKey[k]] = Object.assign({}, old, { no: is.no, severity: is.severity, sevGiven: is.sevGiven, typeLabel: is.typeLabel, action: is.action, file: is.file || old.file });
        if (changed) stat.updated++; else stat.same++;
        return;
      }
      var nu = Object.assign({}, is, { id: gen() });
      byKey[k] = out.length; out.push(nu); stat.added++;
    });
    return { issues: out, stat: stat };
  }
  function modelNames(issues) { return uniq((issues || []).map(function (i) { return i.model; })).sort(); }
  /* 이슈에 나온 모델이 모델 정보에 없으면 빈 칸으로 더합니다(기존 값 유지) */
  function ensureModels(models, issues) {
    var out = Object.assign({}, models || {});
    modelNames(issues).forEach(function (m) { if (!out[m]) out[m] = { kind: '', size: '', newParts: null, note: '' }; });
    return out;
  }

  /* ── 5. 이슈 → 체크 항목 잇기 ──────────────────────────────── */
  /* status: auto(부위+유형 일치) · word(유형은 못 찾았지만 항목 낱말이 겹침) · manual(직접 연결)
           nopart(체크시트에 없는 부위) · notype(부위는 있으나 그 유형 항목이 없음) · unknown(유형·낱말 모두 못 찾음)
           new(직접 「신규 항목 후보」로 표시) · skip(직접 「외관과 무관」으로 제외) */
  var STATUS_LABEL = {
    auto: '자동 연결', word: '낱말로 연결', manual: '직접 연결',
    nopart: '체크시트에 없는 부위', notype: '그 부위에 없는 유형', unknown: '유형을 못 찾음',
    new: '신규 항목 후보(직접)', skip: '제외(외관 무관)'
  };
  function isLinked(st) { return st === 'auto' || st === 'word' || st === 'manual'; }
  function isCandidate(st) { return st === 'nopart' || st === 'notype' || st === 'new'; }
  function needsReview(st) { return st === 'nopart' || st === 'notype' || st === 'unknown'; }

  /* 항목 이름의 낱말 가운데 이슈 내용에 들어 있는 수 — 부위 이름 낱말(「캡」「도어」 등)은 세지 않습니다 */
  function overlap(it, content) {
    var c = str(content), p = norm(it.part);
    return words(it.item).filter(function (w) { return p.indexOf(norm(w)) < 0 && norm(w).indexOf(p) < 0 && c.indexOf(w) >= 0; }).length;
  }
  function issueType(is, kw) {
    if (is.typeLabel) { var t = typeFromLabel(is.typeLabel, kw); if (t) return t; }
    return detectType(is.content, kw).type;
  }
  function matchIssue(is, items, cfg) {
    cfg = cfg || {};
    var syn = cfg.synonyms, kw = cfg.keywords;
    var pk = partOf(is.part, syn), type = issueType(is, kw);
    var res = { status: 'unknown', itemId: '', part: pk, type: type, reason: '' };
    var cands = items.filter(function (it) { return norm(partOf(it.part, syn)) === norm(pk); });
    if (!cands.length) { res.status = 'nopart'; res.reason = '체크시트에 「' + pk + '」 부위가 없습니다.'; return res; }
    function bestOf(list) {
      var b = null, bn = -1;
      list.forEach(function (it) { var n = overlap(it, is.content); if (n > bn) { b = it; bn = n; } });
      return { it: b, n: bn };
    }
    if (type) {
      var same = cands.filter(function (it) { return it.category === type; });
      if (same.length) {
        var b = bestOf(same);
        res.status = 'auto'; res.itemId = b.it.id;
        res.reason = '부위 「' + pk + '」 + 유형 「' + type + '」' + (same.length > 1 ? ' · 항목 낱말 ' + b.n + '개 겹침' : '');
        return res;
      }
      res.status = 'notype'; res.reason = '「' + pk + '」 부위에 「' + type + '」 유형 항목이 없습니다.'; return res;
    }
    var w2 = bestOf(cands);
    if (w2.n >= 1) { res.status = 'word'; res.itemId = w2.it.id; res.reason = '유형은 못 찾았고 항목 낱말 ' + w2.n + '개 겹침'; return res; }
    res.reason = '이슈 내용에서 유형 낱말을 찾지 못했습니다. 직접 연결해 주세요.';
    return res;
  }
  /* 모든 이슈 잇기 — links(직접 연결: issueId → itemId | 'new' | 'skip')가 자동보다 앞섭니다 */
  function matchAll(db) {
    var cfg = cfgOf(db), out = {}, ids = {};
    db.items.forEach(function (it) { ids[it.id] = it; });
    db.issues.forEach(function (is) {
      var m = matchIssue(is, db.items, cfg);
      var l = (db.links || {})[is.id];
      if (l === 'new') { m.status = 'new'; m.itemId = ''; m.reason = '직접 신규 항목 후보로 표시'; }
      else if (l === 'skip') { m.status = 'skip'; m.itemId = ''; m.reason = '직접 제외'; }
      else if (l && ids[l]) { m.status = 'manual'; m.itemId = l; m.reason = '직접 연결'; m.type = ids[l].category || m.type; }
      out[is.id] = m;
    });
    return out;
  }
  function matchSummary(issues, matches) {
    var s = { total: issues.length, linked: 0, review: 0, candidate: 0, skip: 0, by: {} };
    issues.forEach(function (is) {
      var st = matches[is.id].status;
      s.by[st] = (s.by[st] || 0) + 1;
      if (isLinked(st)) s.linked++;
      if (needsReview(st)) s.review++;
      if (isCandidate(st)) s.candidate++;
      if (st === 'skip') s.skip++;
    });
    return s;
  }
  function cfgOf(db) { var st = db && db.settings || {}; return { synonyms: st.partSynonyms || DEFAULT_PART_SYNONYMS, keywords: st.typeKeywords || DEFAULT_TYPE_KEYWORDS }; }

  /* ── 6. 점수 ──────────────────────────────────────────────── */
  var DEFAULT_SETTINGS = {
    weights: { freq: 40, recent: 30, sev: 30 },       // 빈도·최근성·심각도 가중치(합으로 나눔)
    sevWeight: { '상': 3, '중': 2, '하': 1 },
    halfLifeDays: 365,                                // 최근성: 이 날수가 지나면 무게가 절반
    recentDays: 365,                                  // 「최근 이슈」로 셀 기간(표시용)
    sim: { kind: 0.5, size: 0.7, newParts: 0.5 },      // 신규 모델과 특성이 다른 모델의 이슈를 얼마나 반영할지(1 = 똑같이)
    newPartBoost: 1.5,                                // 신규 부품 부위 항목에 곱하는 값
    focusMin: 40,                                     // 이 점수 이상이면 「중점」
    topN: 10                                          // 리포트 우려 포인트 개수
  };
  function cleanSettings(p) {
    var d = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    if (!p || typeof p !== 'object') return Object.assign(d, { partSynonyms: copySyn(DEFAULT_PART_SYNONYMS), typeKeywords: copySyn(DEFAULT_TYPE_KEYWORDS) });
    function num(v, lo, hi, def) { var n = Number(v); return isFinite(n) && n >= lo && n <= hi ? n : def; }
    var w = p.weights || {};
    d.weights = { freq: num(w.freq, 0, 100, d.weights.freq), recent: num(w.recent, 0, 100, d.weights.recent), sev: num(w.sev, 0, 100, d.weights.sev) };
    if (d.weights.freq + d.weights.recent + d.weights.sev === 0) d.weights = JSON.parse(JSON.stringify(DEFAULT_SETTINGS.weights));
    var sw = p.sevWeight || {};
    d.sevWeight = { '상': num(sw['상'], 0, 10, 3), '중': num(sw['중'], 0, 10, 2), '하': num(sw['하'], 0, 10, 1) };
    d.halfLifeDays = num(p.halfLifeDays, 30, 3650, d.halfLifeDays);
    d.recentDays = num(p.recentDays, 30, 3650, d.recentDays);
    var sm = p.sim || {};
    d.sim = { kind: num(sm.kind, 0, 1, d.sim.kind), size: num(sm.size, 0, 1, d.sim.size), newParts: num(sm.newParts, 0, 1, d.sim.newParts) };
    d.newPartBoost = num(p.newPartBoost, 1, 5, d.newPartBoost);
    d.focusMin = num(p.focusMin, 0, 100, d.focusMin);
    d.topN = Math.round(num(p.topN, 3, 30, d.topN));
    d.partSynonyms = cleanSyn(p.partSynonyms) || copySyn(DEFAULT_PART_SYNONYMS);
    d.typeKeywords = cleanSyn(p.typeKeywords) || copySyn(DEFAULT_TYPE_KEYWORDS);
    return d;
  }
  function copySyn(o) { return JSON.parse(JSON.stringify(o)); }
  function cleanSyn(o) {
    if (!o || typeof o !== 'object') return null;
    var out = {}, n = 0;
    Object.keys(o).forEach(function (k) { if (str(k) && Array.isArray(o[k])) { out[str(k)] = o[k].map(str).filter(Boolean); n++; } });
    return n ? out : null;
  }
  /* 사전 글 ↔ 객체 — 한 줄에 「대표 = 다른 이름, 다른 이름」 */
  function synToText(o) { return Object.keys(o || {}).map(function (k) { return k + ' = ' + (o[k] || []).join(', '); }).join('\n'); }
  function textToSyn(t) {
    var out = {};
    String(t || '').split(/\r?\n/).forEach(function (line) {
      var m = /^([^=]+)=(.*)$/.exec(line);
      if (!m) { if (str(line)) out[str(line)] = out[str(line)] || []; return; }
      var k = str(m[1]); if (!k) return;
      out[k] = uniq((out[k] || []).concat(m[2].split(/[,，]/).map(str).filter(Boolean)));
    });
    return out;
  }

  /* 모델 특성이 거르기 조건에 맞는지. filter = {kind,size,newParts}, 빈 값 = 상관없음 */
  function modelPasses(info, filter) {
    if (!filter) return true;
    info = info || {};
    if (filter.kind && info.kind !== filter.kind) return false;
    if (filter.size && info.size !== filter.size) return false;
    if (filter.newParts === true || filter.newParts === false) { if (info.newParts !== filter.newParts) return false; }
    return true;
  }
  /* 신규 모델과 닮은 정도 — 특성이 다르면 설정의 반영률을 곱합니다. 모르는 특성은 다른 것으로 봅니다 */
  function similarity(info, target, sim) {
    if (!target) return 1;
    info = info || {}; sim = sim || DEFAULT_SETTINGS.sim;
    var f = 1;
    if (target.kind && info.kind !== target.kind) f *= sim.kind;
    if (target.size && info.size !== target.size) f *= sim.size;
    if ((target.newParts === true || target.newParts === false) && info.newParts !== target.newParts) f *= sim.newParts;
    return f;
  }
  function maxDate(issues) { return issues.reduce(function (m, i) { return i.date && i.date > m ? i.date : m; }, ''); }

  /* 항목별 점수. opts: { filter, target, refDate }
     빈도 = 이슈 수(닮은 정도 곱) · 최근성 = Σ 0.5^(경과일/반감기) · 심각도 = Σ 심각도 무게
     세 값은 항목 가운데 가장 큰 값을 100 으로 맞춘 뒤 가중 평균합니다. */
  function scoreItems(db, matches, opts) {
    opts = opts || {};
    var S = db.settings || cleanSettings(), models = db.models || {}, target = opts.target || null;
    var ref = opts.refDate || maxDate(db.issues) || '';
    var syn = cfgOf(db).synonyms;
    var newPartKeys = target && target.newParts !== false ? (target.newPartList || []).map(function (p) { return norm(partOf(p, syn)); }) : [];
    var rows = db.items.map(function (it) {
      return { item: it, id: it.id, n: 0, wN: 0, recent: 0, recentN: 0, sev: 0, sevCount: { '상': 0, '중': 0, '하': 0 }, lastDate: '', models: [], issues: [],
        newPart: newPartKeys.indexOf(norm(partOf(it.part, syn))) >= 0 };
    });
    var byId = {}; rows.forEach(function (r) { byId[r.id] = r; });
    var excluded = 0;
    db.issues.forEach(function (is) {
      var m = matches[is.id];
      if (!m || !isLinked(m.status) || !byId[m.itemId]) return;
      var info = models[is.model];
      if (!modelPasses(info, opts.filter)) { excluded++; return; }
      var r = byId[m.itemId], f = similarity(info, target, S.sim);
      var age = is.date && ref ? Math.max(0, daysBetween(is.date, ref)) : null;
      var rec = age == null ? 0 : Math.pow(0.5, age / S.halfLifeDays);
      r.n++; r.wN += f; r.recent += rec * f; r.sev += (S.sevWeight[is.severity] || 0) * f;
      r.sevCount[is.severity] = (r.sevCount[is.severity] || 0) + 1;
      if (age != null && age <= S.recentDays) r.recentN++;
      if (is.date > r.lastDate) r.lastDate = is.date;
      if (r.models.indexOf(is.model) < 0) r.models.push(is.model);
      r.issues.push(is);
    });
    rows.forEach(function (r) { if (r.newPart) { r.wN *= S.newPartBoost; r.recent *= S.newPartBoost; r.sev *= S.newPartBoost; } r.models.sort(); });
    var mx = { wN: 0, recent: 0, sev: 0 };
    rows.forEach(function (r) { mx.wN = Math.max(mx.wN, r.wN); mx.recent = Math.max(mx.recent, r.recent); mx.sev = Math.max(mx.sev, r.sev); });
    var W = S.weights, wsum = W.freq + W.recent + W.sev;
    rows.forEach(function (r) {
      r.freqScore = mx.wN ? 100 * r.wN / mx.wN : 0;
      r.recentScore = mx.recent ? 100 * r.recent / mx.recent : 0;
      r.sevScore = mx.sev ? 100 * r.sev / mx.sev : 0;
      r.score = round((W.freq * r.freqScore + W.recent * r.recentScore + W.sev * r.sevScore) / wsum, 1);
      r.tier = tierOf(r, S);
    });
    var order = {}; db.items.forEach(function (it, i) { order[it.id] = i; });
    rows.sort(function (a, b) { return b.score - a.score || b.n - a.n || order[a.id] - order[b.id]; });
    rows.forEach(function (r, i) { r.rank = i + 1; });
    rows.excluded = excluded; rows.refDate = ref;
    return rows;
  }
  /* 중점: 점수 ≥ 기준 / 생략 후보: 관련 이슈 0건 + 필수 아님 + 신규 부품 부위 아님 / 그 밖: 일반 */
  function tierOf(r, S) {
    if (r.n === 0) return r.item.required || r.newPart ? '일반' : '생략 후보';
    return r.score >= S.focusMin ? '중점' : '일반';
  }
  var TIER_ORDER = { '중점': 0, '일반': 1, '생략 후보': 2, '신규 후보': 3 };

  /* 신규 항목 후보 — 체크시트에 없는 이슈를 (부위·유형) 으로 묶습니다 */
  function candidates(db, matches, opts) {
    opts = opts || {};
    var S = db.settings || cleanSettings(), groups = {}, out = [];
    db.issues.forEach(function (is) {
      var m = matches[is.id];
      if (!m || !isCandidate(m.status)) return;
      var info = (db.models || {})[is.model];
      if (!modelPasses(info, opts.filter)) return;
      var k = norm(m.part) + '|' + (m.type || '기타');
      var g = groups[k];
      if (!g) { g = groups[k] = { key: k, part: m.part, type: m.type || '', n: 0, wN: 0, models: [], lastDate: '', sevCount: { '상': 0, '중': 0, '하': 0 }, issues: [], reason: m.status }; out.push(g); }
      g.n++; g.wN += similarity(info, opts.target, S.sim);
      g.sevCount[is.severity]++;
      if (g.models.indexOf(is.model) < 0) g.models.push(is.model);
      if (is.date > g.lastDate) g.lastDate = is.date;
      g.issues.push(is);
      if (m.status === 'nopart') g.reason = 'nopart';
    });
    out.forEach(function (g) { g.wN = round(g.wN, 2); g.models.sort(); g.suggest = suggestItem(g); });
    out.sort(function (a, b) { return b.wN - a.wN || b.n - a.n || (a.part < b.part ? -1 : 1); });
    return out;
  }
  function suggestItem(g) {
    var t = g.type || '외관';
    var name = { '도장': '도장 외관 상태', '실링': '실링 상태(누수)', '간섭': '작동·개폐 시 간섭', '단차·갭': '단차·갭', '데칼·표시': '데칼 부착 상태', '찍힘·손상': '찍힘·손상', '체결': '체결 상태', '녹·부식': '녹·부식' }[t] || (t + ' 상태');
    return { part: g.part, item: g.part + ' ' + name, method: '육안', criteria: '이슈 리스트 기준으로 정함(작성 필요)', category: g.type || '' };
  }
  /* 후보를 체크시트에 더하기 — 새 항목을 돌려줍니다(db.items 에 넣는 것은 부르는 쪽) */
  function newItemFrom(db, cand, edits) {
    var s = Object.assign({}, cand.suggest || suggestItem(cand), edits || {});
    var gen = nextId(db.items, 'C', 3);
    return { id: gen(), no: '', part: s.part, item: s.item, method: s.method, criteria: s.criteria, category: s.category, guessed: false, required: false, added: true };
  }

  /* ── 7. 신규 개발모델용 체크시트 ────────────────────────────── */
  function optimizeChecklist(db, matches, target) {
    var rows = scoreItems(db, matches, { target: target });
    var order = {}; db.items.forEach(function (it, i) { order[it.id] = i; });
    var sorted = rows.slice().sort(function (a, b) {
      return TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || (a.tier === '생략 후보' ? order[a.id] - order[b.id] : b.score - a.score || order[a.id] - order[b.id]);
    });
    var cands = candidates(db, matches, { target: target });
    var count = { '중점': 0, '일반': 0, '생략 후보': 0, '신규 후보': cands.length };
    sorted.forEach(function (r) { count[r.tier]++; });
    return { target: target, rows: sorted, candidates: cands, count: count, refDate: rows.refDate };
  }
  var SHEET_HEAD = ['순번', '구분', '부위', '점검 항목', '점검 유형', '검사 방법', '판정 기준', '위험 점수', '관련 이슈(건)', '최근 발생', '관련 모델', '근거', '결과(OK/NG)', '비고'];
  function evidenceText(r) {
    if (!r.n) return r.item.required ? '관련 이슈 없음 · 필수 항목' : r.newPart ? '관련 이슈 없음 · 신규 부품 부위' : '관련 이슈 없음';
    var sv = ['상', '중', '하'].filter(function (k) { return r.sevCount[k]; }).map(function (k) { return k + ' ' + r.sevCount[k]; }).join('·');
    return r.n + '건(' + sv + ') · 모델 ' + r.models.length + '개' + (r.lastDate ? ' · 최근 ' + r.lastDate : '') + (r.newPart ? ' · 신규 부품 부위' : '');
  }
  function checklistToAoa(opt, includeOmit) {
    var t = opt.target || {};
    var aoa = [['개발장비 외관검사 체크시트 — ' + (t.name || '신규 개발모델')],
      ['모델 특성: ' + targetText(t) + ' · 기준일 ' + (opt.refDate || '-') + ' · 자동 생성 초안(검토 후 사용)'], [], SHEET_HEAD];
    var i = 0;
    opt.rows.forEach(function (r) {
      if (r.tier === '생략 후보' && !includeOmit) return;
      aoa.push([++i, r.tier, r.item.part, r.item.item, r.item.category, r.item.method, r.item.criteria, r.score, r.n, r.lastDate, r.models.length, evidenceText(r), '', '']);
    });
    opt.candidates.forEach(function (g) {
      aoa.push([++i, '신규 후보', g.part, g.suggest.item, g.type, g.suggest.method, g.suggest.criteria, '', g.n, g.lastDate, g.models.length,
        '체크시트에 없는 이슈 ' + g.n + '건 · 예: ' + g.issues.slice(0, 2).map(function (x) { return x.content; }).join(' / '), '', '']);
    });
    return aoa;
  }
  function targetText(t) {
    t = t || {};
    return [t.kind || '기종 미정', t.size || '크기 미정', t.newParts === true ? '신규 부품 있음' + ((t.newPartList || []).length ? '(' + t.newPartList.join(', ') + ')' : '') : t.newParts === false ? '신규 부품 없음' : '신규 부품 미정'].join(' · ');
  }

  /* ── 8. 이슈 발생 우려 포인트 리포트 ─────────────────────────── */
  /* 특성별 비교 — 모델 한 대당 유형별 이슈 수 (예: 신규 부품 있음 vs 없음) */
  function compareBy(db, matches, feature) {
    var models = db.models || {}, groups = {}, order = [];
    function keyOf(info) {
      if (feature === 'newParts') return info.newParts === true ? '신규 부품 있음' : info.newParts === false ? '신규 부품 없음' : '모름';
      return info[feature] || '모름';
    }
    modelNames(db.issues).forEach(function (m) {
      var k = keyOf(models[m] || {});
      if (!groups[k]) { groups[k] = { key: k, models: [], byType: {}, total: 0 }; order.push(k); }
      groups[k].models.push(m);
    });
    db.issues.forEach(function (is) {
      var m = matches[is.id]; if (!m || m.status === 'skip') return;
      var g = groups[keyOf(models[is.model] || {})];
      var t = m.type || '기타';
      g.byType[t] = (g.byType[t] || 0) + 1; g.total++;
    });
    var types = TYPES.concat(['기타']).filter(function (t) { return order.some(function (k) { return groups[k].byType[t]; }); });
    var out = order.sort().map(function (k) {
      var g = groups[k], n = g.models.length;
      return { key: k, models: g.models, total: g.total, perModel: round(g.total / n, 1),
        byType: types.map(function (t) { return { type: t, n: g.byType[t] || 0, perModel: round((g.byType[t] || 0) / n, 1) }; }) };
    });
    return { feature: feature, types: types, groups: out };
  }
  /* 반복 항목 — 서로 다른 모델 N개 이상에서 나온 항목 */
  function repeatItems(rows, minModels) {
    return rows.filter(function (r) { return r.models.length >= (minModels || 3); })
      .sort(function (a, b) { return b.models.length - a.models.length || b.n - a.n; });
  }
  function buildReport(db, matches, target) {
    var S = db.settings || cleanSettings();
    var opt = optimizeChecklist(db, matches, target);
    var scored = opt.rows.filter(function (r) { return r.n > 0; }).sort(function (a, b) { return b.score - a.score; });
    var top = scored.slice(0, S.topN);
    var dates = db.issues.map(function (i) { return i.date; }).filter(Boolean).sort();
    var cmp = compareBy(db, matches, 'newParts');
    var rep = {
      target: target, refDate: opt.refDate, top: top, count: opt.count, candidates: opt.candidates,
      repeats: repeatItems(scored, 3).slice(0, 10), compare: cmp,
      range: { issues: db.issues.length, models: modelNames(db.issues).length, items: db.items.length, from: dates[0] || '', to: dates[dates.length - 1] || '' },
      summary: matchSummary(db.issues, matches)
    };
    rep.text = reportText(rep, S);
    return rep;
  }
  function reportText(rep, S) {
    var L = [];
    L.push('개발장비 외관검사 — 이슈 발생 우려 포인트 (' + (rep.target && rep.target.name || '신규 개발모델') + ')');
    L.push('모델 특성: ' + targetText(rep.target) + ' · 기준일 ' + (rep.refDate || '-'));
    L.push('근거 데이터: 이슈 ' + rep.range.issues + '건 · 모델 ' + rep.range.models + '개 · 기간 ' + rep.range.from + ' ~ ' + rep.range.to + ' · 체크 항목 ' + rep.range.items + '개');
    L.push('');
    L.push('1. 우려 포인트 상위 ' + rep.top.length + '개');
    rep.top.forEach(function (r, i) { L.push((i + 1) + ') [' + r.tier + '] ' + r.item.part + ' — ' + r.item.item + ' (점수 ' + r.score + ') : ' + evidenceText(r)); });
    L.push('');
    L.push('2. 신규 부품 유무별 모델 1대당 이슈');
    rep.compare.groups.forEach(function (g) {
      L.push('- ' + g.key + ' (모델 ' + g.models.length + '개): 전체 ' + g.perModel + '건/대 · ' + g.byType.filter(function (t) { return t.n; }).map(function (t) { return t.type + ' ' + t.perModel; }).join(', '));
    });
    L.push('');
    L.push('3. 여러 모델에서 되풀이된 항목');
    if (!rep.repeats.length) L.push('- 없음');
    rep.repeats.forEach(function (r) { L.push('- ' + r.item.part + ' — ' + r.item.item + ': 모델 ' + r.models.length + '개 · ' + r.n + '건'); });
    L.push('');
    L.push('4. 체크시트에 없는 이슈(신규 항목 후보)');
    if (!rep.candidates.length) L.push('- 없음');
    rep.candidates.forEach(function (g) { L.push('- ' + g.part + ' · ' + (g.type || '유형 미상') + ': ' + g.n + '건, 모델 ' + g.models.length + '개 — 예: ' + g.issues.slice(0, 2).map(function (x) { return x.content; }).join(' / ')); });
    L.push('');
    L.push('점수 기준: 빈도 ' + S.weights.freq + ' · 최근성 ' + S.weights.recent + ' · 심각도 ' + S.weights.sev + ' (반감기 ' + S.halfLifeDays + '일, 상·중·하 = ' + S.sevWeight['상'] + '·' + S.sevWeight['중'] + '·' + S.sevWeight['하'] + '), 중점 ≥ ' + S.focusMin + '점');
    return L.join('\n');
  }

  /* ── 9. 모델 이름 가리기 (AI 프롬프트) ──────────────────────── */
  var ALIAS_PREFIX = '모델';
  function assignAliases(map, names) {
    var out = {}, used = 0;
    Object.keys(map || {}).forEach(function (n) {
      var m = new RegExp('^' + ALIAS_PREFIX + '(\\d+)$').exec(map[n]);
      if (m) { out[n] = map[n]; used = Math.max(used, +m[1]); }
    });
    uniq((names || []).map(str).filter(Boolean)).forEach(function (n) { if (!out[n]) out[n] = ALIAS_PREFIX + (++used); });
    return out;
  }
  function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\\/-]/g, '\\$&'); }
  /* 글 속에서 바꿔도 되는 이름 — 너무 짧은 이름(2자 이하)은 다른 낱말과 헷갈려 글 속에서는 바꾸지 않습니다 */
  function textMaskable(n) { return n.length >= 3; }
  function nameRegex(names) {
    if (!names.length) return null;
    var list = names.slice().sort(function (a, b) { return b.length - a.length; }).map(escRe);
    return new RegExp('(^|[^0-9A-Za-z가-힣])(' + list.join('|') + ')(?![0-9A-Za-z])', 'g');
  }
  function maskText(text, map) {
    var re = nameRegex(Object.keys(map || {}).filter(textMaskable));
    if (!re || text == null) return text == null ? '' : String(text);
    return String(text).replace(re, function (all, pre, n) { return pre + map[n]; });
  }
  /* AI 답 → 모델 이름. 「모델3」만 바꾸고 「모델 3개」「모델3개」 같은 말은 그대로 */
  function unmaskText(text, map) {
    var back = {};
    Object.keys(map || {}).forEach(function (n) { back[map[n]] = n; });
    return String(text == null ? '' : text).replace(new RegExp(ALIAS_PREFIX + '(\\d+)(?![0-9개건종대가])', 'g'), function (all) { return back[all] || all; });
  }
  function findLeaks(text, names) {
    var s = String(text || '');
    return uniq((names || []).filter(function (n) { if (!textMaskable(n)) return false; var re = nameRegex([n]); return re.test(s); }));
  }

  /* AI 프롬프트 — 계산된 사실만. aliases 가 있으면 모델 이름을 별칭으로 */
  function buildAiPromptInfo(rep, aliases) {
    var map = {};
    function A(n) { if (!aliases) return n; if (aliases[n]) { map[n] = aliases[n]; return aliases[n]; } return n; }
    function M(t) { return aliases ? maskText(t, aliases) : t; }
    var t = rep.target || {};
    var L = [];
    L.push('너는 건설장비 개발 단계 외관품질을 검토하는 선행품질 담당자의 보조야.');
    L.push('아래는 과거 개발모델의 외관검사 이슈 리스트를 체크시트 항목에 이어 계산한 사실이야. 이 사실만 근거로 답해줘. 주어지지 않은 숫자·원인·모델 정보는 만들지 마.');
    L.push('');
    L.push('[신규 개발모델] ' + A(t.name || '신규 모델') + ' — ' + targetText(t));
    L.push('[근거 범위] 이슈 ' + rep.range.issues + '건, 과거 모델 ' + rep.range.models + '개, ' + rep.range.from + ' ~ ' + rep.range.to + ', 체크 항목 ' + rep.range.items + '개');
    L.push('');
    L.push('[우려 포인트 상위 ' + rep.top.length + '개 — 점수 = 빈도·최근성·심각도 가중, 신규 모델과 특성이 다른 모델의 이슈는 낮춰 반영]');
    rep.top.forEach(function (r, i) {
      L.push((i + 1) + '. ' + r.item.part + ' / ' + r.item.item + ' (유형 ' + (r.item.category || '-') + ', 점수 ' + r.score + ', 구분 ' + r.tier + ')');
      L.push('   근거: ' + evidenceText(r) + ' · 관련 모델: ' + r.models.map(A).join(', '));
      r.issues.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; }).slice(0, 3).forEach(function (is) {
        L.push('   - ' + (is.date || '날짜 없음') + ' ' + A(is.model) + ' [' + is.severity + '] ' + M(is.content));
      });
    });
    L.push('');
    L.push('[신규 부품 유무별 모델 1대당 이슈 수]');
    rep.compare.groups.forEach(function (g) {
      L.push('- ' + g.key + ' (모델 ' + g.models.length + '개: ' + g.models.map(A).join(', ') + '): 전체 ' + g.perModel + '건/대 · ' + g.byType.filter(function (x) { return x.n; }).map(function (x) { return x.type + ' ' + x.perModel; }).join(', '));
    });
    L.push('');
    L.push('[여러 모델에서 되풀이된 항목]');
    if (!rep.repeats.length) L.push('- 없음');
    rep.repeats.forEach(function (r) { L.push('- ' + r.item.part + ' / ' + r.item.item + ': 모델 ' + r.models.length + '개, ' + r.n + '건'); });
    L.push('');
    L.push('[체크시트에 없는 이슈 — 신규 항목 후보]');
    if (!rep.candidates.length) L.push('- 없음');
    rep.candidates.forEach(function (g) {
      L.push('- ' + g.part + ' · ' + (g.type || '유형 미상') + ': ' + g.n + '건(모델 ' + g.models.map(A).join(', ') + ') — 예: ' + g.issues.slice(0, 2).map(function (x) { return M(x.content); }).join(' / '));
    });
    L.push('');
    L.push('[요청]');
    L.push('1. 신규 개발모델의 외관검사에서 특히 우려되는 포인트 3~5개를 문장으로 정리해줘. 포인트마다 위 근거 숫자를 함께 적어줘.');
    L.push('2. 각 포인트에서 검사할 때 확인할 점을 1~2줄로 적어줘(체크시트 항목 이름을 그대로 써줘).');
    L.push('3. 신규 항목 후보 가운데 체크시트에 넣을 만한 것과 그 이유를 적어줘.');
    L.push('4. 이 데이터만으로는 판단하기 어려운 점(데이터의 한계)을 짧게 적어줘.');
    var prompt = L.join('\n');
    var names = Object.keys(aliases || {});
    return { prompt: prompt, map: map, leaks: aliases ? findLeaks(prompt, names) : [] };
  }

  /* ── 10. 저장 형식 ───────────────────────────────────────── */
  function emptyDb() {
    return { schemaVersion: SCHEMA_VERSION, items: [], issues: [], models: {}, links: {}, files: [], settings: cleanSettings(),
      target: { name: '', kind: '', size: '', newParts: null, newPartList: [] }, aiNotes: {}, aliases: {}, maskModels: true, sample: false };
  }
  function restoreDb(o) {
    var db = emptyDb();
    if (!o || typeof o !== 'object') return db;
    if (Array.isArray(o.items)) db.items = o.items.filter(function (x) { return x && x.id && x.part && x.item; });
    if (Array.isArray(o.issues)) db.issues = o.issues.filter(function (x) { return x && x.id && (x.part || x.content); }).map(function (x) {
      x.severity = normSeverity(x.severity) || '중'; x.model = str(x.model) || '모델 미상'; x.date = toISO(x.date); return x;
    });
    if (o.models && typeof o.models === 'object') Object.keys(o.models).forEach(function (m) {
      var x = o.models[m] || {};
      db.models[m] = { kind: str(x.kind), size: str(x.size), newParts: x.newParts === true || x.newParts === false ? x.newParts : null, note: str(x.note) };
    });
    if (o.links && typeof o.links === 'object') Object.keys(o.links).forEach(function (k) { if (typeof o.links[k] === 'string' && o.links[k]) db.links[k] = o.links[k]; });
    if (Array.isArray(o.files)) db.files = o.files;
    db.settings = cleanSettings(o.settings);
    if (o.target && typeof o.target === 'object') db.target = {
      name: str(o.target.name), kind: str(o.target.kind), size: str(o.target.size),
      newParts: o.target.newParts === true || o.target.newParts === false ? o.target.newParts : null,
      newPartList: Array.isArray(o.target.newPartList) ? o.target.newPartList.map(str).filter(Boolean) : []
    };
    if (o.aiNotes && typeof o.aiNotes === 'object') db.aiNotes = o.aiNotes;
    if (o.aliases && typeof o.aliases === 'object') db.aliases = assignAliases(o.aliases, []);
    if (o.maskModels === false) db.maskModels = false;
    db.sample = !!o.sample;
    return db;
  }
  /* 모델 특성 값 목록(화면 고르기 칸) */
  function featureValues(models, f) {
    return uniq(Object.keys(models || {}).map(function (m) { return str(models[m][f]); }).filter(Boolean)).sort();
  }
  function partList(db) {
    var syn = cfgOf(db).synonyms;
    return uniq(db.items.map(function (it) { return partOf(it.part, syn); }));
  }

  return {
    VERSION: VERSION,
    SCHEMA_VERSION: SCHEMA_VERSION, TYPES: TYPES, DEFAULT_TYPE_KEYWORDS: DEFAULT_TYPE_KEYWORDS, DEFAULT_PART_SYNONYMS: DEFAULT_PART_SYNONYMS,
    CHECK_FIELDS: CHECK_FIELDS, ISSUE_FIELDS: ISSUE_FIELDS, MODEL_FIELDS: MODEL_FIELDS, FIELD_SETS: FIELD_SETS, DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    STATUS_LABEL: STATUS_LABEL, SHEET_HEAD: SHEET_HEAD, TIER_ORDER: TIER_ORDER, ALIAS_PREFIX: ALIAS_PREFIX,
    str: str, norm: norm, round: round, colName: colName, toISO: toISO, daysBetween: daysBetween, normSeverity: normSeverity, normYN: normYN,
    partOf: partOf, detectType: detectType, typeFromLabel: typeFromLabel, words: words,
    detectColumns: detectColumns, headerSignature: headerSignature, parseChecklist: parseChecklist, parseIssues: parseIssues, parseModels: parseModels, pickSheet: pickSheet,
    itemKey: itemKey, mergeChecklist: mergeChecklist, issueKey: issueKey, mergeIssues: mergeIssues, modelNames: modelNames, ensureModels: ensureModels,
    isLinked: isLinked, isCandidate: isCandidate, needsReview: needsReview, matchIssue: matchIssue, matchAll: matchAll, matchSummary: matchSummary, issueType: issueType,
    cleanSettings: cleanSettings, synToText: synToText, textToSyn: textToSyn, modelPasses: modelPasses, similarity: similarity, maxDate: maxDate,
    scoreItems: scoreItems, candidates: candidates, newItemFrom: newItemFrom, optimizeChecklist: optimizeChecklist, checklistToAoa: checklistToAoa,
    evidenceText: evidenceText, targetText: targetText, compareBy: compareBy, repeatItems: repeatItems, buildReport: buildReport,
    assignAliases: assignAliases, maskText: maskText, unmaskText: unmaskText, findLeaks: findLeaks, buildAiPromptInfo: buildAiPromptInfo,
    emptyDb: emptyDb, restoreDb: restoreDb, featureValues: featureValues, partList: partList
  };
});
