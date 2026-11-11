/* 개발장비 외관평가 Agent — 화면
   계산은 js/logic.js(ExtLogic), 저장은 js/store.js, AI 연결은 js/ai-endpoint.js·ai-panel.js. */
(function () {
  'use strict';
  var L = window.ExtLogic, S = window.ExtStore, AIP = window.AIPanel, Sample = window.ExtSample;
  /* 판 맞추기 — 브라우저가 옛 logic.js 와 새 app.js 를 섞어 쓰면(Pages 캐시) 버튼과 결과가 어긋날 수 있어, 섞였으면 계산하지 않고 새로고침을 안내합니다.
     판은 scripts/bump-version.mjs 로 index.html(?v=) · logic.js 와 함께 올립니다. */
  var APP_VERSION = '2026-11-11.7';
  if (!L || L.VERSION !== APP_VERSION) {
    var m0 = document.getElementById('main') || document.body;
    m0.innerHTML = '<section class="card" id="versionMismatch"><h1>새 판이 나왔습니다 — 새로고침(Ctrl+F5)해 주세요</h1><p class="alert warn">이 브라우저가 옛 파일과 새 파일을 섞어 불러왔습니다(js/logic.js ' +
      (L && L.VERSION ? L.VERSION : '옛 판') + ' · 화면 ' + APP_VERSION + '). 이대로 계산하면 버튼과 결과가 어긋날 수 있어 멈췄습니다.</p>' +
      '<p>Windows 는 <b>Ctrl+F5</b>, Mac 은 <b>Cmd+Shift+R</b> 을 한 번 눌러 주세요. 쌓아 둔 자료는 지워지지 않습니다.</p></section>';
    return;
  }
  (function () { var ft = document.querySelector('.site-footer .inner') || document.querySelector('.site-footer'); if (!ft) return; var s = document.createElement('span'); s.className = 'ver'; s.textContent = ' · 판 ' + APP_VERSION; ft.appendChild(s); })();
  var db = S.loadDb();
  var ui = {
    pending: [], errors: [], progress: '', clMode: 'replace',
    clPart: '', clQuery: '', editId: '',
    mStatus: 'review', mPart: '',
    filter: { kind: '', size: '', newParts: '' }, cmpBy: 'newParts',
    includeOmit: false
  };
  var main = document.getElementById('main');

  /* ── 작은 도구 ───────────────────────────── */
  function h(tag, attrs) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') e.className = v;
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else if (v === true) e.setAttribute(k, '');
      else e.setAttribute(k, v);
    });
    for (var i = 2; i < arguments.length; i++) add(e, arguments[i]);
    return e;
  }
  function add(e, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { add(e, x); }); return; }
    e.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
  }
  function fld(label, control, hint) {
    return h('label', { class: 'field' }, h('span', null, label), control, hint ? h('small', { class: 'hint' }, hint) : null);
  }
  function opt(value, label, selected) { var o = h('option', { value: value }, label); if (selected) o.selected = true; return o; }
  function selectOf(values, cur, aria, onChange) {
    var s = h('select', { 'aria-label': aria });
    values.forEach(function (v) { s.appendChild(opt(v[0], v[1], String(v[0]) === String(cur))); });
    if (onChange) s.addEventListener('change', function () { onChange(s.value); });
    return s;
  }
  var toastTimer = null;
  function toast(msg, err) {
    var t = document.getElementById('toast');
    t.textContent = msg; t.className = 'toast' + (err ? ' error' : ''); t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 3800);
  }
  function save() {
    var ok = S.saveDb(db);
    document.getElementById('storeNote').textContent = ok ? '이 브라우저에 저장됨 · ' + S.sizeKb() + 'KB' : '저장 안 됨(브라우저 저장소가 막혔거나 가득 참) — 설정에서 JSON 백업을 받아 두세요';
    return ok;
  }
  function download(name, blob) {
    var a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function copyText(t) {
    function fallback() { var ta = h('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); toast('복사했습니다.'); } catch (e) { toast('복사하지 못했습니다. 직접 선택해 복사해 주세요.', true); } ta.remove(); }
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(t).then(function () { toast('복사했습니다.'); }, fallback); else fallback();
  }
  function pageHead(stage, title, lead, right) {
    return h('div', { class: 'page-head' }, h('div', { class: 'titles' }, h('div', { class: 'stage' }, stage), h('h1', null, title), lead ? h('p', { class: 'lead' }, lead) : null), right || null);
  }
  function tile(k, v, sub) { return h('div', { class: 'tile' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v), sub ? h('div', { class: 'note' }, sub) : null); }
  function table(head, rows, opts) {
    opts = opts || {};
    var t = h('table', { class: 'list' + (opts.cls ? ' ' + opts.cls : '') });
    var tr = h('tr');
    head.forEach(function (x, i) { tr.appendChild(h('th', { class: opts.num && opts.num[i] ? 'num' : null, scope: 'col' }, x)); });
    t.appendChild(h('thead', null, tr));
    var tb = h('tbody');
    rows.forEach(function (r) {
      var row = h('tr', { class: r.cls || null });
      (r.cells || r).forEach(function (x, i) { row.appendChild(h('td', { class: ((opts.num && opts.num[i] ? 'num' : '') + (r.tdCls && r.tdCls[i] ? ' ' + r.tdCls[i] : '')).trim() || null }, x)); });
      tb.appendChild(row);
    });
    t.appendChild(tb);
    return h('div', { class: 'table-wrap' }, t);
  }
  var TIER_CLS = { '중점': 't-focus', '일반': 't-normal', '생략 후보': 't-omit', '신규 후보': 't-new' };
  function tierTag(t) { return h('span', { class: 'tier ' + (TIER_CLS[t] || '') }, t); }
  function stTag(st) {
    var cls = L.isLinked(st) ? 'ok' : L.needsReview(st) ? 'review' : st === 'new' ? 'cand' : '';
    return h('span', { class: 'st ' + cls }, L.STATUS_LABEL[st] || st);
  }
  function bar(score) { return h('div', { class: 'bar' }, h('i', { style: 'width:' + Math.round(Math.max(2, score * 0.7)) + 'px', 'aria-hidden': 'true' }), h('span', null, score)); }
  function sevText(c) { return ['상', '중', '하'].map(function (k) { return k + ' ' + (c[k] || 0); }).join(' · '); }
  function matches() { return L.matchAll(db); }
  function ready() { return db.items.length > 0 && db.issues.length > 0; }
  function emptyNotice(what) {
    return h('section', { class: 'card empty' },
      h('p', null, what || '체크시트와 이슈 리스트를 먼저 가져와 주세요.'),
      h('p', null, '「데이터 가져오기」에서 엑셀을 넣거나, 가상 샘플로 먼저 둘러봐 주세요.'),
      h('div', { class: 'btn-row', style: 'justify-content:center' },
        h('a', { class: 'btn btn-primary', href: '#/import' }, '데이터 가져오기로'),
        h('button', { type: 'button', class: 'btn', onclick: loadSample }, '가상 샘플로 시작')));
  }
  function itemById(id) { return db.items.filter(function (x) { return x.id === id; })[0]; }
  function syn() { return db.settings.partSynonyms; }

  /* ── 가져오기 ───────────────────────────── */
  function readFile(file, kind) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () {
        try { resolve(prepare(file.name, XLSX.read(new Uint8Array(fr.result), { type: 'array', cellDates: true }), kind)); }
        catch (e) { reject(new Error(file.name + ': 엑셀로 읽지 못했습니다(' + e.message + ')')); }
      };
      fr.onerror = function () { reject(new Error(file.name + ': 파일을 읽지 못했습니다.')); };
      fr.readAsArrayBuffer(file);
    });
  }
  function prepare(name, wb, kind) {
    var sheets = wb.SheetNames.map(function (n) { return { name: n, aoa: XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null }) }; });
    var pick = L.pickSheet(sheets, kind) || sheets[0];
    var it = { kind: kind, fileName: name, sheets: sheets, sheet: pick ? pick.name : '', overrides: {} };
    if (kind === 'issues') {
      var ms = L.pickSheet(sheets.filter(function (s) { return s !== pick; }), 'models');
      if (ms) { var pm = L.parseModels(ms.aoa); if (pm.found) it.models = { sheet: ms.name, models: pm.models }; }
    }
    reparse(it);
    return it;
  }
  function reparse(it) {
    var sh = it.sheets.filter(function (s) { return s.name === it.sheet; })[0];
    it.aoa = sh ? sh.aoa : [];
    it.result = it.kind === 'checklist'
      ? L.parseChecklist(it.aoa, { overrides: it.overrides, keywords: db.settings.typeKeywords })
      : L.parseIssues(it.aoa, { overrides: it.overrides, fileName: it.fileName });
  }
  function handleFiles(list, kind) {
    var files = Array.prototype.slice.call(list || []).filter(function (f) { return !/^~\$/.test(f.name) && /\.(xlsx|xlsm|xls|csv)$/i.test(f.name); });
    if (!files.length) { toast('엑셀 파일(.xlsx·.xls·.csv)을 골라 주세요.', true); return; }
    if (kind === 'checklist') files = files.slice(0, 1);
    ui.errors = [];
    var i = 0;
    (function next() {
      if (i >= files.length) { ui.progress = ''; render(); toast(files.length + '개 파일을 읽었습니다. 아래에서 열 연결을 확인한 뒤 반영해 주세요.'); return; }
      var f = files[i++];
      ui.progress = '읽는 중 ' + i + ' / ' + files.length + ' — ' + f.name;
      readFile(f, kind).then(function (it) {
        ui.pending = ui.pending.filter(function (p) { return !(p.kind === kind && p.fileName === it.fileName) && !(kind === 'checklist' && p.kind === 'checklist'); });
        ui.pending.push(it);
      }, function (e) { ui.errors.push(e.message); }).then(function () { setTimeout(next, 0); });
    })();
  }
  function commitChecklist(it, mode) {
    var r = it.result;
    if (r.det.missing.length) return;
    var m = L.mergeChecklist(db.items, r.items, mode, syn());
    var ids = {}; m.items.forEach(function (x) { ids[x.id] = 1; });
    Object.keys(db.links).forEach(function (k) { var v = db.links[k]; if (v !== 'new' && v !== 'skip' && !ids[v]) delete db.links[k]; });
    db.items = m.items;
    db.files.push({ kind: '체크시트', name: it.fileName, sheet: it.sheet, rows: r.items.length, at: new Date().toISOString().slice(0, 16).replace('T', ' ') });
    return m.stat;
  }
  function commitIssues(it) {
    var r = it.result;
    if (r.det.missing.length) return null;
    var m = L.mergeIssues(db.issues, r.issues, syn());
    db.issues = m.issues;
    if (it.models) Object.keys(it.models.models).forEach(function (k) { db.models[k] = it.models.models[k]; });
    db.models = L.ensureModels(db.models, db.issues);
    db.files.push({ kind: '이슈 리스트', name: it.fileName, sheet: it.sheet + (it.models ? ' + ' + it.models.sheet : ''), rows: r.issues.length, at: new Date().toISOString().slice(0, 16).replace('T', ' ') });
    return m.stat;
  }
  function commit(it) {
    var msg;
    if (it.kind === 'checklist') {
      var s = commitChecklist(it, ui.clMode);
      msg = '체크시트 반영 — 새 항목 ' + s.added + ' · 같은 항목 ' + s.updated + (s.removed ? ' · 빠진 항목 ' + s.removed : '');
    } else {
      var s2 = commitIssues(it);
      msg = '이슈 반영 — 새 이슈 ' + s2.added + ' · 바뀐 이슈 ' + s2.updated + ' · 이미 있음 ' + s2.same + (it.models ? ' · 모델 정보 ' + Object.keys(it.models.models).length + '개' : '');
    }
    db.sample = false;
    ui.pending = ui.pending.filter(function (p) { return p !== it; });
    save(); toast(msg); render();
  }
  function bookFromAoa(sheets) {
    var wb = XLSX.utils.book_new();
    sheets.forEach(function (s) { XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s.aoa), s.name); });
    return XLSX.read(XLSX.write(wb, { bookType: 'xlsx', type: 'array' }), { type: 'array', cellDates: true });
  }
  function loadSample() {
    if ((db.items.length || db.issues.length) && !db.sample && !confirm('지금 데이터를 지우고 가상 샘플을 불러올까요?')) return;
    var keepSettings = db.settings;
    db = L.emptyDb(); db.settings = keepSettings;
    // 앱이 실제 파일을 읽을 때와 같은 길로 — 엑셀 통합문서로 만들었다가 다시 읽습니다
    var c = prepare(Sample.FILES.checklist, bookFromAoa([{ name: '외관검사 체크시트', aoa: Sample.checklistAoa() }]), 'checklist');
    var i = prepare(Sample.FILES.issues, bookFromAoa([{ name: '이슈 리스트', aoa: Sample.issuesAoa() }, { name: '모델 정보', aoa: Sample.modelsAoa() }]), 'issues');
    commitChecklist(c, 'replace'); commitIssues(i);
    db.target = JSON.parse(JSON.stringify(Sample.TARGET));
    db.sample = true;
    ui.pending = [];
    save();
    toast('가상 샘플을 불러왔습니다 — 체크 항목 ' + db.items.length + '개 · 이슈 ' + db.issues.length + '건 · 모델 ' + Object.keys(db.models).length + '개');
    location.hash = '#/match';
    render();
  }

  function fileButton(label, kind, primary, multiple) {
    var input = h('input', { type: 'file', multiple: multiple || null, accept: '.xlsx,.xlsm,.xls,.csv' });
    input.addEventListener('change', function () { handleFiles(input.files, kind); input.value = ''; });
    return h('label', { class: 'btn' + (primary ? ' btn-primary' : '') }, input, label);
  }
  function dropZone(kind, children) {
    var d = h('div', { class: 'drop' }, children);
    d.addEventListener('dragover', function (e) { e.preventDefault(); d.classList.add('over'); });
    d.addEventListener('dragleave', function () { d.classList.remove('over'); });
    d.addEventListener('drop', function (e) { e.preventDefault(); d.classList.remove('over'); handleFiles(e.dataTransfer.files, kind); });
    return d;
  }
  function pageImport() {
    var dates = db.issues.map(function (x) { return x.date; }).filter(Boolean).sort();
    var mode = selectOf([['replace', '새 파일로 바꾸기(빠진 항목은 뺌)'], ['add', '지금 체크시트에 더하기']], ui.clMode, '체크시트 반영 방식', function (v) { ui.clMode = v; });
    return [
      pageHead('0', '데이터 가져오기', '외관검사 체크시트와 이슈 리스트 엑셀을 넣습니다. 열 이름이 달라도 아래에서 열을 이어 주면 됩니다.'),
      h('div', { class: 'grid-2' },
        h('section', { class: 'card' }, h('h2', null, '① 외관검사 체크시트'),
          h('p', { class: 'note' }, '한 줄에 점검 항목 하나. 부위·점검 항목은 꼭 있어야 하고, 검사 방법·판정 기준·점검 유형·필수 칸은 있으면 읽습니다. 유형 칸이 없으면 항목 글로 추정합니다.'),
          dropZone('checklist', [fileButton('체크시트 엑셀 고르기', 'checklist', true), h('span', { class: 'note' }, '또는 여기로 끌어다 놓기')]),
          fld('반영 방식', mode, '같은 부위·항목은 같은 항목으로 보고 연결을 유지합니다.')),
        h('section', { class: 'card' }, h('h2', null, '② 외관검사 이슈 리스트'),
          h('p', { class: 'note' }, '한 줄에 이슈 하나. 모델·부위·이슈 내용은 꼭 있어야 하고, 발생일·심각도·유형·조치는 있으면 읽습니다. 같은 통합문서에 「모델 정보」 시트(모델·기종·크기·신규 부품)가 있으면 함께 읽습니다.'),
          dropZone('issues', [fileButton('이슈 리스트 엑셀 고르기(여러 개 가능)', 'issues', true, true), h('span', { class: 'note' }, '또는 여기로 끌어다 놓기')]),
          h('p', { class: 'note' }, '같은 이슈(모델·발생일·부위·내용이 같음)는 다시 넣어도 한 건으로 셉니다.'))),
      h('section', { class: 'card' }, h('h2', null, '가상 샘플로 먼저 보기'),
        h('p', { class: 'note' }, '체크 항목 62개, 가상 모델 8개(X-60 · X-100 · X-120 · X-140 · X-160 · W-200 · W-220 · W-300)의 이슈 146건입니다. 모두 지어낸 값입니다.'),
        h('div', { class: 'btn-row' },
          h('button', { type: 'button', class: 'btn btn-primary', onclick: loadSample }, '가상 샘플로 시작'),
          h('a', { class: 'btn', href: 'samples/' + Sample.FILES.checklist, download: '' }, '샘플 체크시트 엑셀'),
          h('a', { class: 'btn', href: 'samples/' + Sample.FILES.issues, download: '' }, '샘플 이슈 리스트 엑셀'))),
      ui.progress ? h('p', { class: 'alert info', id: 'importProgress' }, ui.progress) : null,
      ui.errors.length ? h('div', { class: 'alert warn' }, h('ul', null, ui.errors.map(function (e) { return h('li', null, e); }))) : null,
      ui.pending.length ? h('section', { class: 'card' }, h('h2', null, '확인 후 반영 (' + ui.pending.length + '개 파일)'), ui.pending.map(pendingCard)) : null,
      h('section', { class: 'card' }, h('h2', null, '지금 들어 있는 데이터'),
        h('div', { class: 'tiles' },
          tile('체크 항목', db.items.length + '개', L.partList(db).length + '개 부위'),
          tile('이슈', db.issues.length + '건', dates.length ? dates[0] + ' ~ ' + dates[dates.length - 1] : '발생일 없음'),
          tile('모델', Object.keys(db.models).length + '개', '특성은 설정에서 고침'),
          tile('가져온 파일', db.files.length + '개')),
        db.files.length ? table(['종류', '파일', '시트', '행', '가져온 때'], db.files.slice().reverse().map(function (f) { return [f.kind, f.name, f.sheet, f.rows, f.at]; }), { num: [0, 0, 0, 1, 0] }) : null,
        h('div', { class: 'btn-row', style: 'margin-top:12px' },
          h('button', { type: 'button', class: 'btn btn-danger', onclick: function () {
            if (!confirm('체크시트·이슈·연결·모델 정보를 모두 지울까요? (설정과 AI 연결은 남깁니다)')) return;
            var keep = db.settings; db = L.emptyDb(); db.settings = keep; save(); render(); toast('모든 데이터를 지웠습니다.');
          } }, '모든 데이터 지우기')))
    ];
  }
  function pendingCard(it) {
    var r = it.result, det = r.det, fields = L.FIELD_SETS[it.kind];
    var sheetSel = selectOf(it.sheets.map(function (s) { return [s.name, s.name]; }), it.sheet, '시트', function (v) { it.sheet = v; it.overrides = {}; reparse(it); render(); });
    var ex = it.aoa[det.headerRow + 1] || [];
    var mapGrid = h('div', { class: 'map-grid' });
    fields.forEach(function (f) {
      var sel = h('select', { 'aria-label': f.label + ' 열' });
      sel.appendChild(opt('-1', '(이 파일에는 없음)'));
      det.headers.forEach(function (t, i) { sel.appendChild(opt(String(i), L.colName(i) + ' · ' + (t || '(빈 머리)'), det.map[f.id] === i)); });
      sel.addEventListener('change', function () { it.overrides[f.id] = Number(sel.value); reparse(it); render(); });
      var col = det.map[f.id], exv = col == null ? '' : ex[col];
      if (exv instanceof Date) exv = L.toISO(exv);
      mapGrid.appendChild(h('div', { class: 'map-row' + (f.req && col == null ? ' missing' : '') },
        h('span', { class: 'col' }, f.label, f.req ? h('span', { class: 'req' }, ' 필수') : null), sel,
        h('span', { class: 'ex' }, col == null ? '연결 안 됨' : '예: ' + (exv == null || exv === '' ? '(빈칸)' : String(exv)))));
    });
    var list = it.kind === 'checklist' ? r.items : r.issues;
    var preview = it.kind === 'checklist'
      ? table(['부위', '점검 항목', '검사 방법', '판정 기준', '유형'], list.slice(0, 5).map(function (x) { return [x.part, x.item, x.method, x.criteria, x.category + (x.guessed ? ' (추정)' : '')]; }))
      : table(['모델', '발생일', '부위', '이슈 내용', '심각도'], list.slice(0, 5).map(function (x) { return [x.model, x.date, x.part, x.content, x.severity + (x.sevGiven ? '' : ' (빈칸→중)')]; }));
    return h('details', { class: 'block', open: true }, h('summary', null, (it.kind === 'checklist' ? '체크시트 · ' : '이슈 리스트 · ') + it.fileName + (det.missing.length ? ' — 열 연결 필요' : ' — ' + list.length + (it.kind === 'checklist' ? '개 항목' : '건'))),
      h('div', { class: 'form-grid' },
        fld('시트', sheetSel, it.sheets.length > 1 ? '머리행이 가장 잘 맞는 시트를 자동으로 골랐습니다.' : null),
        h('div', { class: 'field' }, h('span', null, '읽은 결과'),
          h('div', null, '머리행 ' + (det.headerRow + 1) + '행 · ' + list.length + (it.kind === 'checklist' ? '개 항목' : '건')),
          it.models ? h('small', { class: 'hint' }, '「' + it.models.sheet + '」 시트에서 모델 정보 ' + Object.keys(it.models.models).length + '개도 함께 읽음') : null)),
      det.warnings.map(function (w) { return h('p', { class: 'alert warn' }, w); }),
      r.warnings.length ? h('details', { class: 'warn-list' }, h('summary', null, '행 점검 알림 ' + r.warnings.length + '건 (반영은 됩니다)'),
        h('ul', null, r.warnings.slice(0, 50).map(function (w) { return h('li', null, w.row + '행: ' + w.msg); }))) : null,
      h('details', { open: det.missing.length ? true : null }, h('summary', null, '열 연결 보기·고치기 (' + Object.keys(det.map).length + '개 연결됨)'), mapGrid),
      list.length ? h('details', null, h('summary', null, '앞 5줄 미리 보기'), preview) : null,
      h('div', { class: 'btn-row', style: 'margin-top:10px' },
        h('button', { type: 'button', class: 'btn btn-primary', disabled: !!det.missing.length || !list.length, onclick: function () { commit(it); } }, '이 파일 반영'),
        h('button', { type: 'button', class: 'btn', onclick: function () { ui.pending = ui.pending.filter(function (p) { return p !== it; }); render(); } }, '빼기')));
  }

  /* ── ① 체크시트 마스터 ─────────────────── */
  function pageChecklist() {
    if (!db.items.length) return [pageHead('①', '체크시트 마스터'), emptyNotice('아직 체크시트가 없습니다.')];
    var parts = L.partList(db);
    var q = ui.clQuery.trim();
    var rows = db.items.filter(function (it) {
      return (!ui.clPart || L.partOf(it.part, syn()) === ui.clPart) && (!q || (it.part + ' ' + it.item + ' ' + it.criteria + ' ' + it.method).indexOf(q) >= 0);
    });
    var m = matches(), cnt = {};
    db.issues.forEach(function (is) { var x = m[is.id]; if (L.isLinked(x.status)) cnt[x.itemId] = (cnt[x.itemId] || 0) + 1; });
    var partSel = selectOf([['', '모든 부위']].concat(parts.map(function (p) { return [p, p]; })), ui.clPart, '부위', function (v) { ui.clPart = v; render(); });
    var qIn = h('input', { value: ui.clQuery, placeholder: '예: 실링, 도막', 'aria-label': '찾기' });
    qIn.addEventListener('change', function () { ui.clQuery = qIn.value; render(); });
    return [
      pageHead('①', '체크시트 마스터', '부위·점검 항목·검사 방법·판정 기준·점검 유형을 정리합니다. 점검 유형이 이슈와 잇는 열쇠입니다.'),
      editForm(),
      h('section', { class: 'card filters' }, fld('부위', partSel), fld('찾기', qIn, '글을 적고 Enter'),
        h('p', { class: 'note span-all' }, '전체 ' + db.items.length + '개 · 보이는 항목 ' + rows.length + '개 · 「(추정)」은 유형 칸이 없어 항목 글로 정한 것입니다. 「필수」는 이슈가 없어도 생략 후보로 빼지 않습니다.')),
      table(['No', '부위', '점검 항목', '검사 방법', '판정 기준', '유형', '필수', '연결 이슈', ''], rows.map(function (it, i) {
        return { cls: it.added ? 'cand' : null, cells: [it.no || String(i + 1), it.part, h('span', null, it.item, it.added ? h('span', { class: 'tier t-new', style: 'margin-left:6px' }, '추가') : null), it.method, it.criteria,
          it.category ? it.category + (it.guessed ? ' (추정)' : '') : h('span', { class: 'st review' }, '없음'), it.required ? '필수' : '', cnt[it.id] || 0,
          h('div', { class: 'btn-row' },
            h('button', { type: 'button', class: 'btn btn-sm', onclick: function () { ui.editId = it.id; render(); window.scrollTo(0, 0); } }, '고치기'),
            h('button', { type: 'button', class: 'btn btn-sm btn-danger', onclick: function () {
              if (!confirm('「' + it.item + '」 항목을 지울까요? 이 항목에 직접 이은 이슈는 다시 자동 연결됩니다.')) return;
              db.items = db.items.filter(function (x) { return x.id !== it.id; });
              Object.keys(db.links).forEach(function (k) { if (db.links[k] === it.id) delete db.links[k]; });
              save(); render();
            } }, '지우기'))] };
      }), { num: [0, 0, 0, 0, 0, 0, 0, 1, 0] }),
      h('div', { class: 'btn-row', style: 'margin-top:12px' },
        h('button', { type: 'button', class: 'btn', onclick: function () {
          var aoa = [['No', '부위', '점검 항목', '검사 방법', '판정 기준', '점검 유형', '필수']];
          db.items.forEach(function (it, i) { aoa.push([it.no || i + 1, it.part, it.item, it.method, it.criteria, it.category, it.required ? 'Y' : '']); });
          var wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), '외관검사 체크시트');
          XLSX.writeFile(wb, '외관검사_체크시트_마스터.xlsx');
        } }, '마스터 엑셀로 내려받기'))
    ];
  }
  function editForm() {
    var cur = ui.editId ? itemById(ui.editId) : null;
    var v = cur || { part: '', item: '', method: '', criteria: '', category: '', required: false };
    var part = h('input', { value: v.part, list: 'partList', placeholder: '예: 캡' });
    var item = h('input', { value: v.item, placeholder: '예: 캡 루프 실링 상태' });
    var method = h('input', { value: v.method, placeholder: '예: 육안·살수 시험' });
    var crit = h('input', { value: v.criteria, placeholder: '예: 누수 없을 것' });
    var cat = selectOf([['', '(항목 글로 추정)']].concat(Object.keys(db.settings.typeKeywords).map(function (t) { return [t, t]; })), v.category, '점검 유형');
    var req = h('input', { type: 'checkbox' }); req.checked = !!v.required;
    var dl = h('datalist', { id: 'partList' }, L.partList(db).map(function (p) { return h('option', { value: p }); }));
    function submit() {
      if (!part.value.trim() || !item.value.trim()) { toast('부위와 점검 항목을 적어 주세요.', true); return; }
      var c = cat.value || L.detectType(item.value + ' ' + crit.value, db.settings.typeKeywords).type;
      var data = { part: part.value.trim(), item: item.value.trim(), method: method.value.trim(), criteria: crit.value.trim(), category: c, guessed: !cat.value && !!c, required: req.checked };
      if (cur) { Object.assign(cur, data); toast('고쳤습니다.'); }
      else { var nu = L.newItemFrom(db, { suggest: data }, data); nu.added = false; nu.guessed = data.guessed; nu.required = data.required; db.items.push(nu); toast('항목을 더했습니다.'); }
      ui.editId = ''; save(); render();
    }
    return h('section', { class: 'card' }, h('h2', null, cur ? '항목 고치기 — ' + cur.item : '항목 더하기'), dl,
      h('div', { class: 'form-grid' }, fld('부위', part), fld('점검 항목', item), fld('검사 방법', method), fld('판정 기준', crit), fld('점검 유형', cat),
        h('label', { class: 'opt', style: 'align-self:end' }, req, h('span', null, h('span', { class: 't' }, '필수(생략 금지)'), h('span', { class: 's' }, '안전·법규 표시 등')))),
      h('div', { class: 'btn-row', style: 'margin-top:10px' },
        h('button', { type: 'button', class: 'btn btn-primary', onclick: submit }, cur ? '고친 내용 저장' : '항목 더하기'),
        cur ? h('button', { type: 'button', class: 'btn', onclick: function () { ui.editId = ''; render(); } }, '취소') : null));
  }

  /* ── ② 이슈 매칭 ───────────────────────── */
  function itemSelect(is, m) {
    var s = h('select', { 'aria-label': '연결할 체크 항목' });
    var link = db.links[is.id] || '';
    s.appendChild(opt('', '자동' + (L.isLinked(m.status) && m.status !== 'manual' ? ' — ' + (itemById(m.itemId) || {}).item : m.status !== 'manual' && m.status !== 'new' && m.status !== 'skip' ? ' — ' + L.STATUS_LABEL[m.status] : ''), !link));
    s.appendChild(opt('new', '신규 항목 후보로 표시', link === 'new'));
    s.appendChild(opt('skip', '외관과 무관(제외)', link === 'skip'));
    var parts = L.partList(db), mine = m.part;
    parts.sort(function (a, b) { return (a === mine ? -1 : 0) - (b === mine ? -1 : 0); });
    parts.forEach(function (p) {
      var g = h('optgroup', { label: p + (p === mine ? ' (이 부위)' : '') });
      db.items.filter(function (it) { return L.partOf(it.part, syn()) === p; }).forEach(function (it) { g.appendChild(opt(it.id, it.item + (it.category ? ' · ' + it.category : ''), link === it.id)); });
      s.appendChild(g);
    });
    s.addEventListener('change', function () {
      if (s.value) db.links[is.id] = s.value; else delete db.links[is.id];
      save(); render();
    });
    return s;
  }
  function pageMatch() {
    if (!ready()) return [pageHead('②', '이슈 → 체크 항목 잇기'), emptyNotice()];
    var m = matches(), sum = L.matchSummary(db.issues, m);
    var review = db.issues.filter(function (is) { return L.needsReview(m[is.id].status); });
    var cands = L.candidates(db, m);
    var STS = [['review', '확인 필요'], ['', '전체'], ['auto', '자동 연결'], ['word', '낱말로 연결'], ['manual', '직접 연결'], ['nopart', '체크시트에 없는 부위'], ['notype', '그 부위에 없는 유형'], ['unknown', '유형을 못 찾음'], ['new', '신규 후보(직접)'], ['skip', '제외']];
    var list = db.issues.filter(function (is) {
      var st = m[is.id].status;
      return (ui.mStatus === '' || (ui.mStatus === 'review' ? L.needsReview(st) : st === ui.mStatus)) && (!ui.mPart || m[is.id].part === ui.mPart);
    });
    var partsIn = []; db.issues.forEach(function (is) { var p = m[is.id].part; if (partsIn.indexOf(p) < 0) partsIn.push(p); }); partsIn.sort();
    return [
      pageHead('②', '이슈 → 체크 항목 잇기', '부위 이름을 맞추고(CAB = 캐빈 = 캡) 이슈 내용의 낱말로 유형을 찾아 체크 항목에 잇습니다. 못 이은 이슈는 직접 고르거나 신규 항목 후보로 둡니다.'),
      h('div', { class: 'tiles' },
        tile('전체 이슈', sum.total + '건'),
        tile('체크 항목에 연결', sum.linked + '건', Math.round(100 * sum.linked / Math.max(1, sum.total)) + '%'),
        tile('확인 필요', sum.review + '건', '부위·유형을 못 이음'),
        tile('신규 항목 후보', cands.length + '묶음', sum.candidate + '건 · 체크시트에 없는 이슈')),
      h('section', { class: 'card' }, h('h2', null, '확인이 필요한 이슈 (' + review.length + '건)'),
        review.length ? [h('p', { class: 'note' }, '오른쪽에서 이을 항목을 고르면 바로 반영됩니다. 체크시트에 정말 없는 이슈는 그대로 두면 아래 「신규 항목 후보」에 모입니다.'),
          h('div', { class: 'issue-review' }, review.map(function (is) {
            var x = m[is.id];
            return h('div', { class: 'ir' },
              h('div', null, h('div', { class: 'what' }, is.content), h('div', { class: 'meta' }, is.model + ' · ' + (is.date || '날짜 없음') + ' · 부위 「' + is.part + '」 → ' + x.part + ' · 유형 ' + (x.type || '못 찾음') + ' · 심각도 ' + is.severity),
                h('div', { class: 'meta' }, stTag(x.status), ' ', x.reason)),
              itemSelect(is, x));
          }))] : h('p', { class: 'note' }, '모든 이슈가 체크 항목에 이어졌거나 직접 정리되었습니다.')),
      h('section', { class: 'card' }, h('h2', null, '신규 항목 후보 — 체크시트에 없는 이슈'),
        cands.length ? [h('p', { class: 'note' }, '부위·유형이 같은 이슈를 묶었습니다. 「체크시트에 더하기」를 누르면 항목이 생기고, 그 이슈들이 새 항목에 이어집니다(이름·방법·기준은 고쳐서 더해 주세요).'),
          h('div', { class: 'cand-list' }, cands.map(candCard))] : h('p', { class: 'note' }, '체크시트에 없는 이슈가 없습니다.')),
      h('section', { class: 'card' }, h('h2', null, '연결 결과 전체'),
        h('div', { class: 'filters', style: 'margin-bottom:12px' },
          fld('상태', selectOf(STS, ui.mStatus, '상태', function (v) { ui.mStatus = v; render(); })),
          fld('부위(맞춘 이름)', selectOf([['', '모든 부위']].concat(partsIn.map(function (p) { return [p, p]; })), ui.mPart, '부위', function (v) { ui.mPart = v; render(); })),
          h('p', { class: 'note span-all' }, list.length + '건' + (list.length > 200 ? ' — 앞 200건만 보입니다. 상태·부위로 좁혀 주세요.' : ''))),
        table(['모델', '발생일', '부위(원문 → 맞춤)', '이슈 내용', '심각도', '유형', '상태', '연결'], list.slice(0, 200).map(function (is) {
          var x = m[is.id];
          return [is.model, is.date, is.part === x.part ? x.part : is.part + ' → ' + x.part, is.content, is.severity, x.type || '-', stTag(x.status), itemSelect(is, x)];
        }), { cls: 'match', num: [0, 0, 0, 0, 0, 0, 0, 0] }))
    ];
  }
  function candCard(g) {
    var part = h('input', { value: g.suggest.part, 'aria-label': '부위' });
    var item = h('input', { value: g.suggest.item, 'aria-label': '점검 항목' });
    var method = h('input', { value: g.suggest.method, 'aria-label': '검사 방법' });
    var crit = h('input', { value: g.suggest.criteria, 'aria-label': '판정 기준' });
    var cat = selectOf([['', '(없음)']].concat(Object.keys(db.settings.typeKeywords).map(function (t) { return [t, t]; })), g.type, '점검 유형');
    return h('div', { class: 'cand' },
      h('h3', null, g.part + ' · ' + (g.type || '유형 미상') + ' — ' + g.n + '건'),
      h('div', { class: 'kv' }, h('span', null, '모델 ', h('b', null, g.models.join(', '))), h('span', null, '최근 ', h('b', null, g.lastDate || '-')), h('span', null, '심각도 ', h('b', null, sevText(g.sevCount))),
        h('span', null, g.reason === 'nopart' ? '체크시트에 이 부위가 없음' : '이 부위에 이 유형 항목이 없음')),
      h('ul', null, g.issues.slice(0, 4).map(function (is) { return h('li', null, is.model + ' · ' + (is.date || '') + ' · ' + is.content); })),
      h('div', { class: 'form-grid' }, fld('부위', part), fld('점검 항목', item), fld('검사 방법', method), fld('판정 기준', crit), fld('점검 유형', cat)),
      h('div', { class: 'btn-row', style: 'margin-top:8px' },
        h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
          var nu = L.newItemFrom(db, g, { part: part.value.trim() || g.part, item: item.value.trim() || g.suggest.item, method: method.value.trim(), criteria: crit.value.trim(), category: cat.value });
          db.items.push(nu);
          // 묶음의 이슈를 새 항목에 직접 잇습니다(부위 이름을 바꿔 적어도 이어지도록)
          g.issues.forEach(function (is) { db.links[is.id] = nu.id; });
          save(); render(); toast('「' + nu.item + '」 항목을 체크시트에 더하고 이슈 ' + g.issues.length + '건을 이었습니다.');
        } }, '체크시트에 더하기')));
  }

  /* ── ③ 항목별 위험 점수 ─────────────────── */
  function filterCard(onChange) {
    var kinds = L.featureValues(db.models, 'kind'), sizes = L.featureValues(db.models, 'size');
    return h('section', { class: 'card filters' },
      fld('기종', selectOf([['', '모든 기종']].concat(kinds.map(function (k) { return [k, k]; })), ui.filter.kind, '기종', function (v) { ui.filter.kind = v; onChange(); })),
      fld('크기', selectOf([['', '모든 크기']].concat(sizes.map(function (k) { return [k, k]; })), ui.filter.size, '크기', function (v) { ui.filter.size = v; onChange(); })),
      fld('신규 부품', selectOf([['', '상관없음'], ['y', '신규 부품 있는 모델'], ['n', '신규 부품 없는 모델']], ui.filter.newParts, '신규 부품', function (v) { ui.filter.newParts = v; onChange(); })),
      h('p', { class: 'note span-all' }, '고른 특성의 모델에서 나온 이슈만 셉니다. 모델 특성은 「설정 → 모델 특성」에서 고칩니다.'));
  }
  function curFilter() {
    var f = ui.filter;
    if (!f.kind && !f.size && !f.newParts) return null;
    return { kind: f.kind, size: f.size, newParts: f.newParts === 'y' ? true : f.newParts === 'n' ? false : null };
  }
  function pageScore() {
    if (!ready()) return [pageHead('③', '항목별 위험 점수'), emptyNotice()];
    var m = matches(), rows = L.scoreItems(db, m, { filter: curFilter() }), St = db.settings;
    var used = rows.reduce(function (s, r) { return s + r.n; }, 0);
    var tc = { '중점': 0, '일반': 0, '생략 후보': 0 }; rows.forEach(function (r) { tc[r.tier]++; });
    var partSum = {};
    rows.forEach(function (r) {
      var p = L.partOf(r.item.part, syn()), x = partSum[p] || (partSum[p] = { part: p, items: 0, n: 0, focus: 0, top: null });
      x.items++; x.n += r.n; if (r.tier === '중점') x.focus++; if (!x.top || r.score > x.top.score) x.top = r;
    });
    var parts = Object.keys(partSum).map(function (k) { return partSum[k]; }).sort(function (a, b) { return b.n - a.n; });
    var cmp = L.compareBy(db, m, ui.cmpBy);
    return [
      pageHead('③', '항목별 위험 점수', '체크 항목마다 이어진 이슈의 빈도·최근성·심각도로 점수(0~100)를 냅니다. 가중치는 설정에서 바꿉니다.'),
      filterCard(render),
      h('div', { class: 'tiles' },
        tile('센 이슈', used + '건', rows.excluded ? '특성이 안 맞아 뺀 이슈 ' + rows.excluded + '건' : '체크 항목에 이어진 이슈'),
        tile('중점 항목', tc['중점'] + '개', '점수 ' + St.focusMin + ' 이상'),
        tile('생략 후보', tc['생략 후보'] + '개', '관련 이슈 0건 · 필수 아님'),
        tile('기준일', rows.refDate || '-', '최근성 반감기 ' + St.halfLifeDays + '일')),
      h('section', { class: 'card' }, h('h2', null, '항목별 점수'),
        h('p', { class: 'note' }, '점수 = 빈도 ' + St.weights.freq + ' · 최근성 ' + St.weights.recent + ' · 심각도 ' + St.weights.sev + ' 의 가중 평균(각 값은 가장 큰 항목을 100 으로). 최근 = 기준일에서 ' + St.recentDays + '일 안.'),
        table(['순위', '구분', '부위', '점검 항목', '유형', '이슈', '최근', '심각도', '최근 발생', '모델', '점수'], rows.map(function (r) {
          return { cls: r.tier === '생략 후보' ? 'omit' : null, cells: [r.rank, tierTag(r.tier), r.item.part, r.item.item, r.item.category || '-', r.n, r.recentN, r.n ? sevText(r.sevCount) : '-', r.lastDate || '-', r.models.length, bar(r.score)] };
        }), { num: [1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0] })),
      h('div', { class: 'grid-2' },
        h('section', { class: 'card' }, h('h2', null, '부위별 합계'),
          table(['부위', '항목', '이슈', '중점', '가장 높은 항목'], parts.map(function (x) { return [x.part, x.items, x.n, x.focus, x.top && x.top.n ? x.top.item.item + ' (' + x.top.score + ')' : '-']; }), { num: [0, 1, 1, 1, 0] })),
        h('section', { class: 'card' }, h('h2', null, '모델 특성별 비교 (모델 1대당 이슈)'),
          fld('나눌 특성', selectOf([['newParts', '신규 부품 유무'], ['kind', '기종'], ['size', '크기']], ui.cmpBy, '나눌 특성', function (v) { ui.cmpBy = v; render(); })),
          compareTable(cmp),
          h('p', { class: 'note' }, '체크시트에 없는 이슈도 유형별로 함께 셉니다(제외한 이슈만 뺌). 거르기 조건과 상관없이 전체 모델로 셉니다.')))
    ];
  }
  function compareTable(cmp) {
    return table(['구분', '모델'].concat(cmp.types).concat(['전체']), cmp.groups.map(function (g) {
      return [g.key, g.models.length + '개'].concat(g.byType.map(function (t) { return t.perModel; })).concat([g.perModel]);
    }), { num: [0, 1].concat(cmp.types.map(function () { return 1; })).concat([1]) });
  }

  /* ── ④ 신규 모델 체크시트 ───────────────── */
  function targetForm() {
    var t = db.target;
    var name = h('input', { value: t.name, placeholder: '예: X-180(개발 중)' });
    var kind = h('input', { value: t.kind, list: 'kindList', placeholder: '예: 굴착기' });
    var size = h('input', { value: t.size, list: 'sizeList', placeholder: '예: 대형' });
    var np = t.newParts === true ? 'y' : t.newParts === false ? 'n' : '';
    var radios = [['y', '있음'], ['n', '없음'], ['', '아직 모름']].map(function (o) {
      var r = h('input', { type: 'radio', name: 'np', value: o[0] }); r.checked = np === o[0];
      return h('label', { class: 'opt' }, r, h('span', null, h('span', { class: 't' }, o[1])));
    });
    var partBoxes = L.partList(db).map(function (p) {
      var c = h('input', { type: 'checkbox', value: p }); c.checked = (t.newPartList || []).indexOf(p) >= 0;
      return h('label', { class: 'opt' }, c, h('span', null, h('span', { class: 't' }, p)));
    });
    function read() {
      var v = (radios.map(function (l) { return l.querySelector('input'); }).filter(function (r) { return r.checked; })[0] || {}).value || '';
      db.target = { name: name.value.trim(), kind: kind.value.trim(), size: size.value.trim(), newParts: v === 'y' ? true : v === 'n' ? false : null,
        newPartList: v === 'y' ? partBoxes.map(function (l) { return l.querySelector('input'); }).filter(function (c) { return c.checked; }).map(function (c) { return c.value; }) : [] };
      save(); render(); toast('신규 개발모델 특성을 저장했습니다.');
    }
    return h('section', { class: 'card' }, h('h2', null, '신규 개발모델 특성'),
      h('datalist', { id: 'kindList' }, L.featureValues(db.models, 'kind').map(function (k) { return h('option', { value: k }); })),
      h('datalist', { id: 'sizeList' }, L.featureValues(db.models, 'size').map(function (k) { return h('option', { value: k }); })),
      h('div', { class: 'form-grid' }, fld('모델 이름', name), fld('기종', kind, '과거 모델과 같은 이름으로 적어야 닮은 모델로 셉니다.'), fld('크기', size)),
      h('fieldset', { class: 'block', style: 'margin-top:14px' }, h('legend', null, '신규 부품'), h('div', { class: 'radio-row' }, radios)),
      h('fieldset', { class: 'block' }, h('legend', null, '신규 부품이 들어가는 부위(신규 부품 있음일 때)'),
        h('p', { class: 'note' }, '고른 부위의 항목은 점수에 ' + db.settings.newPartBoost + '배를 곱하고, 이슈가 없어도 생략 후보로 빼지 않습니다.'), h('div', { class: 'part-grid' }, partBoxes)),
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn btn-primary', onclick: read }, '특성 저장하고 체크시트 만들기'),
        db.sample ? h('button', { type: 'button', class: 'btn', onclick: function () { db.target = JSON.parse(JSON.stringify(Sample.TARGET)); save(); render(); } }, '샘플 예시 값') : null));
  }
  function pageOptimize() {
    if (!ready()) return [pageHead('④', '신규 모델 체크시트'), emptyNotice()];
    var t = db.target, m = matches(), o = L.optimizeChecklist(db, m, t), St = db.settings;
    var shown = o.rows.filter(function (r) { return ui.includeOmit || r.tier !== '생략 후보'; });
    var omitBox = h('input', { type: 'checkbox' }); omitBox.checked = ui.includeOmit;
    omitBox.addEventListener('change', function () { ui.includeOmit = omitBox.checked; render(); });
    var i = 0;
    var body = shown.map(function (r) {
      return { cls: r.tier === '생략 후보' ? 'omit' : null, cells: [++i, tierTag(r.tier), r.item.part, r.item.item, r.item.method, r.item.criteria, r.n ? bar(r.score) : '-', L.evidenceText(r)] };
    }).concat(o.candidates.map(function (g) {
      return { cls: 'cand', cells: [++i, tierTag('신규 후보'), g.part, g.suggest.item, g.suggest.method, g.suggest.criteria, '-', '체크시트에 없는 이슈 ' + g.n + '건 · 모델 ' + g.models.length + '개 · 예: ' + g.issues[0].content] };
    }));
    return [
      pageHead('④', '신규 모델 체크시트', '신규 개발모델의 특성으로 과거 이슈를 다시 무게 매겨, 위험한 항목을 앞으로 올린 체크시트를 만듭니다.',
        h('div', { class: 'btn-row no-print' },
          h('button', { type: 'button', class: 'btn btn-primary', onclick: function () { exportChecklist(o); } }, '엑셀로 내려받기'),
          h('button', { type: 'button', class: 'btn', onclick: function () { window.print(); } }, '인쇄'))),
      h('div', { class: 'no-print' }, targetForm()),
      h('div', { class: 'tiles no-print' },
        tile('중점', o.count['중점'] + '개', '점수 ' + St.focusMin + ' 이상 — 맨 앞'),
        tile('일반', o.count['일반'] + '개'),
        tile('생략 후보', o.count['생략 후보'] + '개', '관련 이슈 0건 — 검토 후 생략'),
        tile('신규 후보', o.count['신규 후보'] + '개', '체크시트에 없는 이슈')),
      h('section', { class: 'card' },
        h('div', { class: 'print-title' }, h('h1', null, '개발장비 외관검사 체크시트 — ' + (t.name || '신규 개발모델')), h('p', null, L.targetText(t) + ' · 기준일 ' + (o.refDate || '-') + ' · 자동 생성 초안(검토 후 사용)')),
        h('div', { class: 'page-head no-print', style: 'margin-bottom:10px' }, h('div', { class: 'titles' }, h('h2', null, (t.name || '신규 개발모델') + ' — ' + L.targetText(t)),
          h('div', { class: 'legend-tiers' }, tierTag('중점'), '이슈가 잦고 최근·심각', tierTag('일반'), '그 밖', tierTag('생략 후보'), '이슈 없음', tierTag('신규 후보'), '체크시트에 없던 이슈')),
          h('label', { class: 'opt' }, omitBox, h('span', null, h('span', { class: 't' }, '생략 후보도 표에 넣기')))),
        !t.kind && !t.size && t.newParts == null ? h('p', { class: 'alert info no-print' }, '모델 특성을 넣지 않아 모든 과거 모델의 이슈를 똑같이 셉니다.') : null,
        table(['순번', '구분', '부위', '점검 항목', '검사 방법', '판정 기준', '점수', '근거'], body, { cls: 'sheet', num: [1, 0, 0, 0, 0, 0, 0, 0] }),
        h('p', { class: 'note' }, '닮은 정도: 기종이 다르면 ×' + St.sim.kind + ', 크기가 다르면 ×' + St.sim.size + ', 신규 부품 유무가 다르면 ×' + St.sim.newParts + ' 로 과거 이슈를 반영합니다(설정에서 바꿈).'))
    ];
  }
  function exportChecklist(o) {
    var wb = XLSX.utils.book_new();
    var ws = XLSX.utils.aoa_to_sheet(L.checklistToAoa(o, ui.includeOmit));
    ws['!cols'] = [5, 9, 12, 30, 9, 14, 24, 8, 9, 11, 8, 40, 11, 14].map(function (w) { return { wch: w }; });
    XLSX.utils.book_append_sheet(wb, ws, '체크시트');
    var det = [['부위', '점검 항목', '유형', '구분', '점수', '빈도 점수', '최근성 점수', '심각도 점수', '이슈(건)', '최근(건)', '상', '중', '하', '최근 발생', '관련 모델', '신규 부품 부위']];
    o.rows.forEach(function (r) {
      det.push([r.item.part, r.item.item, r.item.category, r.tier, r.score, L.round(r.freqScore, 1), L.round(r.recentScore, 1), L.round(r.sevScore, 1), r.n, r.recentN, r.sevCount['상'], r.sevCount['중'], r.sevCount['하'], r.lastDate, r.models.join(', '), r.newPart ? 'Y' : '']);
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(det), '점수 근거');
    var iss = [['모델', '발생일', '부위', '이슈 내용', '심각도', '연결 상태', '연결 항목']];
    var m = matches();
    db.issues.forEach(function (is) { var x = m[is.id]; iss.push([is.model, is.date, is.part, is.content, is.severity, L.STATUS_LABEL[x.status], x.itemId ? (itemById(x.itemId) || {}).item : '']); });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(iss), '이슈 연결');
    XLSX.writeFile(wb, '외관검사_체크시트_' + safeName(o.target.name || '신규모델') + '.xlsx');
  }
  function safeName(s) { return String(s).replace(/[\\/:*?"<>|\s]+/g, '_'); }

  /* ── ⑤ 우려 포인트 리포트 · AI ───────────── */
  function noteKey() { return db.target.name || '(이름 없음)'; }
  function pageReport() {
    if (!ready()) return [pageHead('⑤', '이슈 발생 우려 포인트'), emptyNotice()];
    var m = matches(), rep = L.buildReport(db, m, db.target);
    var mask = db.maskModels !== false;
    var names = L.modelNames(db.issues).concat(db.target.name ? [db.target.name] : []);
    if (mask) db.aliases = L.assignAliases(db.aliases, names);
    var info = L.buildAiPromptInfo(rep, mask ? db.aliases : null);
    function back(t) { return mask ? L.unmaskText(t, db.aliases) : t; }
    var key = noteKey();
    var answer = h('textarea', { rows: 10, placeholder: 'AI 답을 여기에 붙여 넣어 주세요. 별칭(모델1 등)은 모델 이름으로 되돌려 리포트의 「AI 의견」에 넣습니다.' });
    answer.value = (db.aiNotes || {})[key] || '';
    answer.addEventListener('input', function () { db.aiNotes[key] = back(answer.value); save(); });
    answer.addEventListener('change', function () { var b = back(answer.value); if (b !== answer.value) { answer.value = b; toast('답의 별칭을 모델 이름으로 되돌렸습니다.'); } render(); });
    var promptBox = h('textarea', { rows: 14, readonly: true, class: 'mono' }); promptBox.value = info.prompt;
    var maskBox = h('input', { type: 'checkbox' }); maskBox.checked = mask;
    maskBox.addEventListener('change', function () { db.maskModels = maskBox.checked; save(); render(); });
    var mapRows = Object.keys(info.map).sort(function (a, b) { return Number(info.map[a].slice(2)) - Number(info.map[b].slice(2)); }).map(function (n) { return [info.map[n], n]; });
    var paper = reportPaper(rep);
    return [
      pageHead('⑤', '이슈 발생 우려 포인트', '신규 개발모델(④에서 정한 특성) 기준으로 우려 포인트를 근거 숫자와 함께 정리하고, AI 에게 문장으로 다듬어 달라고 부탁합니다.',
        h('div', { class: 'btn-row no-print' },
          h('button', { type: 'button', class: 'btn btn-primary', onclick: function () { window.print(); } }, '인쇄 / PDF'),
          h('button', { type: 'button', class: 'btn', onclick: function () { exportWord(rep, paper); } }, 'Word 로'),
          h('button', { type: 'button', class: 'btn', onclick: function () { exportReportXlsx(rep); } }, '엑셀로'),
          h('button', { type: 'button', class: 'btn', onclick: function () { copyText(rep.text + ((db.aiNotes || {})[key] ? '\n\nAI 의견(검토 후 사용)\n' + db.aiNotes[key] : '')); } }, '글자로 복사'))),
      !db.target.name && !db.target.kind ? h('p', { class: 'alert info no-print' }, '④ 화면에서 신규 개발모델 특성을 넣으면 그 모델 기준으로 무게가 바뀝니다. 지금은 모든 과거 모델을 똑같이 셉니다.') : null,
      h('section', { class: 'card paper' }, paper),
      h('section', { class: 'card no-print', id: 'ai' }, h('h2', null, 'AI 로 문장 다듬기 (반자동 기본)'),
        h('ol', { class: 'steps' },
          h('li', null, '아래 프롬프트를 복사해 회사가 허용한 AI(ChatGPT 등)에 붙여 넣어 주세요. 계산된 숫자와 이슈 내용만 들어 있습니다. 모델 이름은 기본으로 「모델1」 같은 별칭으로 바꿉니다.'),
          h('li', null, '받은 답을 「AI 답」 칸에 붙여 넣으면 별칭이 모델 이름으로 돌아가 위 리포트의 「AI 의견」에 들어갑니다. 답은 꼭 검토해 주세요.')),
        h('div', { class: 'mask-box' },
          h('label', { class: 'opt' }, maskBox, h('span', null, h('span', { class: 't' }, '모델 이름 가리기(외부 AI 에 모델 이름을 보내지 않음)'),
            h('span', { class: 's' }, '대응표는 이 브라우저에만 있고, 같은 모델은 늘 같은 별칭입니다.'))),
          mask && info.leaks.length ? h('p', { class: 'alert warn' }, '가리지 못한 모델 이름이 프롬프트에 남아 있습니다: ' + info.leaks.join(', ') + ' — 보내기 전에 지워 주세요.') : null,
          mask ? h('p', { class: 'note' }, info.leaks.length ? '' : '확인: 프롬프트에 실제 모델 이름이 없습니다(모델 ' + names.length + '개 대조). 부위·이슈 내용은 그대로 들어갑니다.') : h('p', { class: 'alert info' }, '지금은 모델 이름이 그대로 들어갑니다. 회사 보안 기준을 확인해 주세요.'),
          mask && mapRows.length ? h('details', null, h('summary', null, '별칭 대응표 — ' + mapRows.length + '개 (이 PC 에만 있음)'), table(['별칭', '모델'], mapRows, { cls: 'alias' })) : null),
        promptBox,
        h('div', { class: 'btn-row', style: 'margin:10px 0' },
          h('button', { type: 'button', class: 'btn btn-primary', onclick: function () { copyText(info.prompt); } }, '프롬프트 복사'),
          AIP.sendButton('설정한 AI 서버로 보내기(선택)', function () { return info.prompt; }, function (text) { text = back(text); answer.value = text; db.aiNotes[key] = text; save(); render(); toast('AI 답을 받았습니다(별칭은 모델 이름으로 되돌림). 검토 후 쓰세요.'); },
            { toast: toast, settingsHref: '#/settings', system: '너는 건설장비 외관품질 검토 보조야. 주어진 사실 밖의 숫자를 만들지 마.' })),
        fld('AI 답 (' + key + ')', answer, '붙여 넣은 답은 이 브라우저에 저장됩니다.'))
    ];
  }
  function reportPaper(rep) {
    var t = rep.target || {}, St = db.settings, ai = (db.aiNotes || {})[noteKey()];
    var n = 1;
    return h('div', { class: 'rp' },
      h('h1', null, '개발장비 외관검사 — 이슈 발생 우려 포인트'),
      h('p', { class: 'note' }, (t.name || '신규 개발모델') + ' · ' + L.targetText(t) + ' · 기준일 ' + (rep.refDate || '-') + ' · 작성: 선행품질파트 · 자동 생성 초안(검토 후 사용)'),
      h('p', null, '근거 데이터: 이슈 ' + rep.range.issues + '건 · 과거 모델 ' + rep.range.models + '개 · ' + rep.range.from + ' ~ ' + rep.range.to + ' · 체크 항목 ' + rep.range.items + '개 (체크 항목에 이어진 이슈 ' + rep.summary.linked + '건)'),
      h('h2', null, (n++) + '. 우려 포인트 상위 ' + rep.top.length + '개'),
      table(['순위', '구분', '부위', '점검 항목', '점수', '근거', '대표 이슈'], rep.top.map(function (r, i) {
        var last = r.issues.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; })[0];
        return [i + 1, tierTag(r.tier), r.item.part, r.item.item, r.score, L.evidenceText(r), last ? last.model + ' · ' + last.content : ''];
      }), { num: [1, 0, 0, 0, 1, 0, 0] }),
      h('h2', null, (n++) + '. 신규 부품 유무별 모델 1대당 이슈'),
      compareTable(rep.compare),
      h('h2', null, (n++) + '. 여러 모델에서 되풀이된 항목 (모델 3개 이상)'),
      rep.repeats.length ? table(['부위', '점검 항목', '유형', '모델 수', '이슈(건)'], rep.repeats.map(function (r) { return [r.item.part, r.item.item, r.item.category, r.models.length, r.n]; }), { num: [0, 0, 0, 1, 1] }) : h('p', null, '없음'),
      h('h2', null, (n++) + '. 체크시트에 없는 이슈 (신규 항목 후보)'),
      rep.candidates.length ? h('ul', null, rep.candidates.map(function (g) {
        return h('li', null, h('strong', null, g.part + ' · ' + (g.type || '유형 미상')), ' — ' + g.n + '건, 모델 ' + g.models.join(', ') + ' · 예: ' + g.issues.slice(0, 2).map(function (x) { return x.content; }).join(' / '));
      })) : h('p', null, '없음'),
      h('p', { class: 'note' }, '점수 기준: 빈도 ' + St.weights.freq + ' · 최근성 ' + St.weights.recent + ' · 심각도 ' + St.weights.sev + ' (반감기 ' + St.halfLifeDays + '일), 중점 ≥ ' + St.focusMin + '점. 체크 항목 구분 수: 중점 ' + rep.count['중점'] + ' · 일반 ' + rep.count['일반'] + ' · 생략 후보 ' + rep.count['생략 후보'] + '.'),
      ai ? [h('h2', null, (n++) + '. AI 의견 (검토 후 사용)'), h('div', { class: 'pre' }, ai)] : null);
  }
  function exportWord(rep, paper) {
    var html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>이슈 발생 우려 포인트</title>' +
      '<style>body{font-family:"맑은 고딕",sans-serif;font-size:10.5pt} table{border-collapse:collapse;margin:6px 0} th,td{border:1px solid #999;padding:3px 6px;font-size:9.5pt} th{background:#eef2f7} h1{font-size:16pt} h2{font-size:12.5pt;margin-top:14pt} .pre{white-space:pre-wrap} .bar i{display:none}</style></head><body>' +
      paper.innerHTML + '</body></html>';
    download('외관검사_우려포인트_' + safeName(noteKey()) + '.doc', new Blob(['﻿' + html], { type: 'application/msword' }));
  }
  function exportReportXlsx(rep) {
    var wb = XLSX.utils.book_new();
    var text = rep.text + ((db.aiNotes || {})[noteKey()] ? '\n\nAI 의견(검토 후 사용)\n' + db.aiNotes[noteKey()] : '');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(text.split('\n').map(function (s) { return [s]; })), '리포트');
    var top = [['순위', '구분', '부위', '점검 항목', '유형', '점수', '이슈(건)', '최근(건)', '상', '중', '하', '최근 발생', '관련 모델']];
    rep.top.forEach(function (r, i) { top.push([i + 1, r.tier, r.item.part, r.item.item, r.item.category, r.score, r.n, r.recentN, r.sevCount['상'], r.sevCount['중'], r.sevCount['하'], r.lastDate, r.models.join(', ')]); });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(top), '우려 포인트');
    var cmp = [['구분', '모델 수'].concat(rep.compare.types).concat(['전체(건/대)'])];
    rep.compare.groups.forEach(function (g) { cmp.push([g.key, g.models.length].concat(g.byType.map(function (t) { return t.perModel; })).concat([g.perModel])); });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(cmp), '특성별 비교');
    var cand = [['부위', '유형', '이슈(건)', '모델', '최근 발생', '예']];
    rep.candidates.forEach(function (g) { cand.push([g.part, g.type, g.n, g.models.join(', '), g.lastDate, g.issues.slice(0, 3).map(function (x) { return x.content; }).join(' / ')]); });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(cand), '신규 항목 후보');
    XLSX.writeFile(wb, '외관검사_우려포인트_' + safeName(noteKey()) + '.xlsx');
  }

  /* ── 설정 ───────────────────────────────── */
  function pageSettings() {
    var St = db.settings;
    var defs = [
      ['weights.freq', '빈도 가중치', St.weights.freq, '0~100'], ['weights.recent', '최근성 가중치', St.weights.recent, '0~100'], ['weights.sev', '심각도 가중치', St.weights.sev, '0~100'],
      ['sevWeight.상', '심각도 「상」 무게', St.sevWeight['상'], ''], ['sevWeight.중', '심각도 「중」 무게', St.sevWeight['중'], ''], ['sevWeight.하', '심각도 「하」 무게', St.sevWeight['하'], ''],
      ['halfLifeDays', '최근성 반감기(일)', St.halfLifeDays, '이 날수가 지나면 무게 절반'], ['recentDays', '「최근」으로 볼 기간(일)', St.recentDays, '표시용'], ['focusMin', '「중점」 점수 기준', St.focusMin, '0~100'],
      ['sim.kind', '기종이 다를 때 반영률', St.sim.kind, '0~1 (1 = 똑같이)'], ['sim.size', '크기가 다를 때 반영률', St.sim.size, '0~1'], ['sim.newParts', '신규 부품 유무가 다를 때 반영률', St.sim.newParts, '0~1'],
      ['newPartBoost', '신규 부품 부위 배수', St.newPartBoost, '1~5'], ['topN', '리포트 우려 포인트 개수', St.topN, '3~30']
    ];
    var inputs = defs.map(function (d) { return { key: d[0], el: h('input', { type: 'number', step: 'any', value: d[2], 'aria-label': d[1] }), d: d }; });
    var synBox = h('textarea', { rows: 10, class: 'mono' }); synBox.value = L.synToText(St.partSynonyms);
    var kwBox = h('textarea', { rows: 8, class: 'mono' }); kwBox.value = L.synToText(St.typeKeywords);
    var models = Object.keys(db.models).sort();
    var mRows = models.map(function (mn) {
      var x = db.models[mn];
      var k = h('input', { value: x.kind, 'aria-label': mn + ' 기종' }), s = h('input', { value: x.size, 'aria-label': mn + ' 크기' });
      var np = selectOf([['', '모름'], ['y', '있음'], ['n', '없음']], x.newParts === true ? 'y' : x.newParts === false ? 'n' : '', mn + ' 신규 부품');
      var note = h('input', { value: x.note || '', 'aria-label': mn + ' 비고' });
      return { mn: mn, k: k, s: s, np: np, note: note, cells: [h('strong', null, mn), k, s, np, note] };
    });
    var backup = h('input', { type: 'file', accept: '.json' });
    backup.addEventListener('change', function () {
      var f = backup.files[0]; if (!f) return;
      f.text().then(function (t) {
        var o = JSON.parse(t); if (!o || !Array.isArray(o.items) || !Array.isArray(o.issues)) throw new Error('이 도구의 백업 파일이 아닙니다.');
        db = L.restoreDb(o); save(); toast('백업을 불러왔습니다(항목 ' + db.items.length + ' · 이슈 ' + db.issues.length + ').'); render();
      }).catch(function (e) { toast('불러오지 못했습니다: ' + e.message, true); });
    });
    return [
      pageHead('설정', '점수 · 사전 · 모델 특성 · AI · 백업'),
      h('section', { class: 'card' }, h('h2', null, '점수 가중치'),
        h('p', { class: 'note' }, '점수 = (빈도×가중치 + 최근성×가중치 + 심각도×가중치) ÷ 가중치 합. 빈도·최근성·심각도는 항목 가운데 가장 큰 값을 100 으로 맞춘 값입니다.'),
        h('div', { class: 'form-grid' }, inputs.map(function (x) { return fld(x.d[1], x.el, x.d[3] || null); })),
        h('div', { class: 'btn-row', style: 'margin-top:10px' },
          h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
            var p = JSON.parse(JSON.stringify(St));
            inputs.forEach(function (x) { var ks = x.key.split('.'); if (ks.length === 2) p[ks[0]][ks[1]] = Number(x.el.value); else p[ks[0]] = Number(x.el.value); });
            db.settings = L.cleanSettings(p); save(); render(); toast('점수 기준을 저장했습니다(범위를 벗어난 값은 기본값으로).');
          } }, '저장'),
          h('button', { type: 'button', class: 'btn', onclick: function () {
            var keep = { partSynonyms: St.partSynonyms, typeKeywords: St.typeKeywords };
            db.settings = L.cleanSettings(keep); save(); render(); toast('점수 기준을 기본값으로 돌렸습니다.');
          } }, '기본값으로'))),
      h('div', { class: 'grid-2' },
        h('section', { class: 'card' }, h('h2', null, '부위 이름 사전'),
          h('p', { class: 'note' }, '한 줄에 「대표 이름 = 다르게 적는 이름, …」. 이슈 리스트와 체크시트의 부위를 이 대표 이름으로 맞춥니다. 「LH·RH·좌측·우측」 같은 위치 낱말과 괄호 안 글은 자동으로 뺍니다.'),
          synBox,
          h('div', { class: 'btn-row', style: 'margin-top:10px' },
            h('button', { type: 'button', class: 'btn btn-primary', onclick: function () { db.settings.partSynonyms = L.textToSyn(synBox.value); db.settings = L.cleanSettings(db.settings); save(); render(); toast('부위 사전을 저장했습니다. 연결을 다시 계산했습니다.'); } }, '사전 저장'),
            h('button', { type: 'button', class: 'btn', onclick: function () { db.settings.partSynonyms = JSON.parse(JSON.stringify(L.DEFAULT_PART_SYNONYMS)); save(); render(); } }, '기본 사전'))),
        h('section', { class: 'card' }, h('h2', null, '점검 유형 낱말 사전'),
          h('p', { class: 'note' }, '한 줄에 「유형 = 낱말, …」. 이슈 내용에 든 낱말 수가 가장 많은 유형으로 봅니다(같으면 위쪽 유형). 체크시트의 유형 이름과 같아야 이어집니다.'),
          kwBox,
          h('div', { class: 'btn-row', style: 'margin-top:10px' },
            h('button', { type: 'button', class: 'btn btn-primary', onclick: function () { db.settings.typeKeywords = L.textToSyn(kwBox.value); db.settings = L.cleanSettings(db.settings); save(); render(); toast('유형 사전을 저장했습니다. 연결을 다시 계산했습니다.'); } }, '사전 저장'),
            h('button', { type: 'button', class: 'btn', onclick: function () { db.settings.typeKeywords = JSON.parse(JSON.stringify(L.DEFAULT_TYPE_KEYWORDS)); save(); render(); } }, '기본 사전')))),
      h('section', { class: 'card' }, h('h2', null, '모델 특성'),
        h('p', { class: 'note' }, '이슈 리스트의 「모델 정보」 시트에서 읽었거나 이슈에 나온 모델입니다. 기종·크기·신규 부품을 채우면 ③ 거르기와 ④ 닮은 정도에 쓰입니다.'),
        models.length ? table(['모델', '기종', '크기', '신규 부품', '비고'], mRows.map(function (r) { return r.cells; }), { cls: 'items' }) : h('p', { class: 'note' }, '아직 모델이 없습니다.'),
        models.length ? h('div', { class: 'btn-row', style: 'margin-top:10px' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
          mRows.forEach(function (r) { db.models[r.mn] = { kind: r.k.value.trim(), size: r.s.value.trim(), newParts: r.np.value === 'y' ? true : r.np.value === 'n' ? false : null, note: r.note.value.trim() }; });
          save(); render(); toast('모델 특성을 저장했습니다.');
        } }, '모델 특성 저장')) : null),
      AIP.settingsCard({ toast: toast, onChange: render }),
      h('section', { class: 'card' }, h('h2', null, '백업'),
        h('p', { class: 'note' }, '체크시트·이슈·연결·설정은 이 브라우저에만 있습니다. 다른 PC 로 옮기거나 브라우저 정리 전에 JSON 으로 받아 두세요. (AI 키는 백업에 들어가지 않습니다)'),
        h('div', { class: 'btn-row' },
          h('button', { type: 'button', class: 'btn', onclick: function () { download('외관평가_백업_' + new Date().toISOString().slice(0, 10) + '.json', new Blob([JSON.stringify(db)], { type: 'application/json' })); } }, 'JSON 백업 내려받기'),
          h('label', { class: 'btn' }, backup, 'JSON 백업 불러오기')))
    ];
  }

  /* ── 라우터 ─────────────────────────────── */
  var PAGES = [
    { id: 'import', no: '0', t: '데이터 가져오기', s: '체크시트·이슈 엑셀', fn: pageImport },
    { id: 'checklist', no: '①', t: '체크시트 마스터', s: '부위·항목·방법·기준', fn: pageChecklist },
    { id: 'match', no: '②', t: '이슈 매칭', s: '이슈 → 체크 항목', fn: pageMatch },
    { id: 'score', no: '③', t: '항목별 위험 점수', s: '빈도·최근성·심각도', fn: pageScore },
    { id: 'optimize', no: '④', t: '신규 모델 체크시트', s: '중점·일반·생략·신규', fn: pageOptimize },
    { id: 'report', no: '⑤', t: '우려 포인트 리포트', s: '근거 숫자 + AI', fn: pageReport },
    { id: 'settings', no: '설', t: '설정', s: '점수·사전·모델·AI', fn: pageSettings }
  ];
  function route() { var id = (location.hash || '').replace(/^#\//, '').split('?')[0]; return PAGES.filter(function (p) { return p.id === id; })[0] || (ready() ? PAGES[2] : PAGES[0]); }
  function render() {
    var p = route();
    var nav = document.getElementById('nav'); nav.innerHTML = '';
    PAGES.forEach(function (x) {
      nav.appendChild(h('a', { href: '#/' + x.id, 'aria-current': x === p ? 'page' : null }, h('span', { class: 'no' }, x.no), h('span', { class: 't' }, x.t), h('span', { class: 's' }, x.s)));
    });
    document.getElementById('dataChip').textContent = ready() || db.items.length || db.issues.length
      ? '체크 항목 ' + db.items.length + '개 · 이슈 ' + db.issues.length + '건 · 모델 ' + Object.keys(db.models).length + '개' + (db.target.name ? ' · 신규 ' + db.target.name : '')
      : '데이터 없음';
    var b = document.getElementById('sampleBanner');
    b.hidden = !db.sample;
    b.textContent = '지금 보시는 것은 가상 샘플입니다(가짜 모델 X-60~X-160 · W-200~W-300). 신규 부품 모델의 실링·간섭 이슈, 되풀이되는 도장 이슈, 체크시트에 없는 이슈(공구함·배터리커버·캡도어 녹)를 일부러 심어 두었습니다. 실제 파일을 쓰려면 먼저 「모든 데이터 지우기」를 해 주세요.';
    main.innerHTML = '';
    add(main, p.fn());
    document.title = p.t + ' — 개발장비 외관평가 Agent';
    save();
  }
  window.addEventListener('hashchange', function () { render(); main.focus(); window.scrollTo(0, 0); });
  render();
})();
