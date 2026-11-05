// 실행: node test/logic.test.mjs   (의존성 없음 — vendor 의 SheetJS 만 씀)
// 수강생 실제 체크시트·이슈 리스트는 아직 받지 않았습니다(기획서 10장). 같은 모양의 작은 가상 표와 가상 샘플로 검사합니다.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const L = require('../js/logic.js');
const Sample = require('../js/sample-data.js');
const XLSX = require('../vendor/xlsx.full.min.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
}

// 작은 가상 체크시트·이슈 (머리행 이름을 실제와 다르게 적은 판)
const CL = [
  ['외관 체크시트'],
  ['순번', '검사부위', '검사항목', '점검방법', '판정기준', '구분', '법규'],
  [1, '캡', '캡 루프 실링 상태', '살수', '누수 없을 것', '실링', ''],
  [2, null, '캡 외판 도장 흐름', '육안', '흐름 없을 것', '도장', ''],          // 병합 칸(부위 빈칸)
  [3, '붐', '붐 도장 흐름·오렌지필', '육안', '없을 것', '도장', ''],
  [4, '붐', '붐 도막 두께', '도막계', '기준 이상', '', ''],                 // 유형 빈칸 → 추정(도장)
  [5, '붐', '붐 배관 간섭', '작동', '간섭 없을 것', '간섭', ''],
  [6, '엔진후드', '고온 주의 데칼', '육안', '부착', '데칼', 'Y'],            // 유형 「데칼」 → 데칼·표시
];
const IS = [
  ['No', '모델명', '발생일자', '발생부위', '불량내용', '등급'],
  ['E1', 'T-1', '2026-03-01', 'CAB', '루프 실러 끊김으로 누수', 'A'],
  ['E2', 'T-1', '2026.3.5', 'BOOM LH', '도장 흐름 발생', 'B'],
  ['E3', 'T-2', 46100, '붐(우측)', '도막 두께 부족', 'C'],                 // 엑셀 날짜 일련번호
  ['E4', 'T-2', '2026-04-01', '공구함', '공구함 도어 단차', '중'],          // 체크시트에 없는 부위
  ['E5', 'T-2', '2026-04-02', '캡', '캡 하단 녹 발생', '하'],               // 캡에 녹 항목 없음
  ['E6', 'T-3', '2026-04-03', '엔진 후드', '지적사항 확인 필요', ''],       // 유형 못 찾음, 심각도 빈칸
  ['E7', 'T-3', '2026-04-04', '붐', '배관 브래킷 접촉', '심각'],
  [null, null, null, null, null, null]
];
function tinyDb() {
  const db = L.emptyDb();
  db.items = L.mergeChecklist([], L.parseChecklist(CL).items, 'replace').items;
  db.issues = L.mergeIssues([], L.parseIssues(IS).issues).issues;
  db.models = { 'T-1': { kind: '굴착기', size: '중형', newParts: true }, 'T-2': { kind: '굴착기', size: '대형', newParts: false }, 'T-3': { kind: '휠로더', size: '중형', newParts: false } };
  return db;
}
function sampleDb() {
  const db = L.emptyDb();
  db.items = L.mergeChecklist([], L.parseChecklist(Sample.checklistAoa()).items, 'replace').items;
  db.issues = L.mergeIssues([], L.parseIssues(Sample.issuesAoa()).issues).issues;
  db.models = L.parseModels(Sample.modelsAoa()).models;
  return db;
}

console.log('기본 다루기');
test('날짜 읽기 — 글·점·빗금·일련번호·Date', () => {
  assert.equal(L.toISO('2026-03-05'), '2026-03-05');
  assert.equal(L.toISO('2026.3.5'), '2026-03-05');
  assert.equal(L.toISO('2026/03/05 10:00'), '2026-03-05');
  assert.equal(L.toISO('20260305'), '2026-03-05');
  assert.equal(L.toISO(46100), '2026-03-19');
  assert.equal(L.toISO(new Date(2026, 0, 2)), '2026-01-02');
  assert.equal(L.toISO('미정'), '');
  assert.equal(L.toISO('2026-13-01'), '');
});
test('심각도 → 상·중·하, 예/아니오', () => {
  assert.deepEqual(['A', 'High', '중대', '상', 'B', '보통', 'c', '경미', '', '???'].map(L.normSeverity), ['상', '상', '상', '상', '중', '중', '하', '하', '', '']);
  assert.deepEqual(['Y', '신규', 'O', 'N', '기존', 'X', '', '글쎄'].map(L.normYN), [true, true, true, false, false, false, null, null]);
});
test('부위 이름 맞추기 — 영문·다른 이름·위치 낱말·괄호', () => {
  const p = s => L.partOf(s);
  assert.equal(p('CAB'), '캡'); assert.equal(p('캐빈'), '캡'); assert.equal(p('캡(좌측)'), '캡');
  assert.equal(p('BOOM LH'), '붐'); assert.equal(p('붐(우측)'), '붐'); assert.equal(p('붐 RH'), '붐');
  assert.equal(p('C/W'), '카운터웨이트'); assert.equal(p('카운터 웨이트'), '카운터웨이트');
  assert.equal(p('엔진 후드'), '엔진후드'); assert.equal(p('HOOD'), '엔진후드');
  assert.equal(p('사이드 커버 RH'), '사이드커버');
  assert.equal(p('도어'), '캡도어'); assert.equal(p('캡 도어'), '캡도어');
  assert.equal(p('새부위 LH'), '새부위', '사전에 없으면 위치 낱말만 빼고 그대로');
  assert.equal(p(''), '');
});
test('부위 사전은 바꿀 수 있음 — 사용자 사전이 기본보다 먼저', () => {
  const syn = { '루프': ['지붕', 'ROOF'] };
  assert.equal(L.partOf('지붕', syn), '루프');
  assert.equal(L.partOf('CAB', syn), 'CAB', '사용자 사전에 없으면 기본 사전을 쓰지 않음');
});
test('유형 찾기 — 낱말 수가 많은 유형, 같으면 앞 유형', () => {
  assert.equal(L.detectType('루프 실러 끊김으로 살수 시 누수').type, '실링');
  assert.equal(L.detectType('패킹 틈으로 물샘').type, '실링');
  assert.equal(L.detectType('방수 고무 들뜸으로 누수').type, '실링', '실링 2 > 데칼 1');
  assert.equal(L.detectType('볼트 체결 마킹 누락').type, '체결');
  assert.equal(L.detectType('잠금장치와 커버 간섭').type, '간섭', '간섭 1 = 체결 1 → 앞 유형');
  assert.equal(L.detectType('고객 시승 시 지적').type, '');
  assert.equal(L.typeFromLabel('데칼'), '데칼·표시');
  assert.equal(L.typeFromLabel('녹'), '녹·부식');
  assert.equal(L.typeFromLabel('실링'), '실링');
});
test('사전 글 ↔ 객체', () => {
  const o = L.textToSyn('캡 = CAB, 캐빈\n붐=BOOM\n\n캡 = 운전실');
  assert.deepEqual(o, { '캡': ['CAB', '캐빈', '운전실'], '붐': ['BOOM'] });
  assert.deepEqual(L.textToSyn(L.synToText(L.DEFAULT_PART_SYNONYMS)), L.DEFAULT_PART_SYNONYMS);
});

console.log('가져오기');
test('체크시트 열 찾기 — 다른 머리 이름(검사부위·검사항목·구분·법규)', () => {
  const r = L.parseChecklist(CL);
  assert.equal(r.det.headerRow, 1);
  assert.deepEqual(r.det.missing, []);
  assert.equal(r.items.length, 6);
  assert.equal(r.items[1].part, '캡', '병합 칸은 위 행 부위');
  assert.equal(r.items[3].category, '도장'); assert.equal(r.items[3].guessed, true);
  assert.equal(r.items[5].category, '데칼·표시'); assert.equal(r.items[5].required, true);
});
test('이슈 열 찾기 — 모델명·발생부위·불량내용·등급, 날짜 3가지 모양', () => {
  const r = L.parseIssues(IS, { fileName: 't.xlsx' });
  assert.deepEqual(r.det.missing, []);
  assert.equal(r.issues.length, 7, '빈 행은 건너뜀');
  assert.deepEqual(r.issues.map(x => x.date).slice(0, 3), ['2026-03-01', '2026-03-05', '2026-03-19']);
  assert.deepEqual(r.issues.map(x => x.severity), ['상', '중', '하', '중', '하', '중', '상']);
  assert.equal(r.issues[5].sevGiven, false, '빈 심각도는 「중」으로 두고 표시');
});
test('필수 열이 없으면 반영 안 함, 열 연결로 고치면 됨', () => {
  const aoa = [['모델', '위치', '현상'], ['T-1', '캡', '누수']];
  let r = L.parseIssues(aoa);
  assert.equal(r.issues.length, 1, '위치·현상은 별칭에 있어 바로 연결');
  const aoa2 = [['모델', '구역', '메모'], ['T-1', '캡', '누수']];
  r = L.parseIssues(aoa2);
  assert.deepEqual(r.det.missing.sort(), ['content', 'part']);
  assert.equal(r.issues.length, 0);
  r = L.parseIssues(aoa2, { overrides: { part: 1, content: 2 } });
  assert.deepEqual(r.det.missing, []);
  assert.equal(r.issues[0].part, '캡');
});
test('모델 정보 시트·시트 고르기', () => {
  const m = L.parseModels(Sample.modelsAoa());
  assert.equal(Object.keys(m.models).length, 8);
  assert.deepEqual(m.models['X-120'], { kind: '굴착기', size: '중형', newParts: true, note: '신규 캡·도어 적용' });
  const sheets = [{ name: '모델 정보', aoa: Sample.modelsAoa() }, { name: '이슈 리스트', aoa: Sample.issuesAoa() }, { name: '체크', aoa: Sample.checklistAoa() }];
  assert.equal(L.pickSheet(sheets, 'issues').name, '이슈 리스트');
  assert.equal(L.pickSheet(sheets, 'checklist').name, '체크');
  assert.equal(L.pickSheet(sheets, 'models').name, '모델 정보');
});
test('체크시트 다시 넣기 — 같은 부위+항목은 같은 id, 바꾸기/더하기', () => {
  const a = L.parseChecklist(CL).items;
  const m1 = L.mergeChecklist([], a, 'replace');
  const again = L.mergeChecklist(m1.items, a.slice(0, 4).map(x => Object.assign({}, x, { part: x.part === '붐' ? 'BOOM' : x.part })), 'replace');
  assert.deepEqual(again.items.map(x => x.id), m1.items.slice(0, 4).map(x => x.id), '부위를 영문으로 적어도 같은 항목');
  assert.equal(again.stat.removed, 2);
  const added = L.mergeChecklist(m1.items, [{ part: '미러', item: '미러 간섭', category: '간섭' }], 'add');
  assert.equal(added.items.length, 7); assert.equal(added.items[6].id, 'C007'); assert.equal(added.items[0].id, m1.items[0].id);
});
test('이슈 다시 넣기 — 같은 이슈는 한 건, 심각도만 바뀜', () => {
  const a = L.parseIssues(IS).issues;
  const m1 = L.mergeIssues([], a);
  const b = a.map(x => Object.assign({}, x, { part: x.part === 'CAB' ? '캐빈' : x.part, severity: x.no === 'E2' ? '상' : x.severity }));
  const m2 = L.mergeIssues(m1.issues, b);
  assert.equal(m2.issues.length, 7);
  assert.deepEqual(m2.stat, { added: 0, updated: 1, same: 6 });
  assert.equal(m2.issues[1].severity, '상');
});

console.log('잇기');
test('이슈 → 체크 항목: 자동·없는 부위·없는 유형·못 찾음', () => {
  const db = tinyDb(), m = L.matchAll(db), by = no => m[db.issues.find(x => x.no === no).id];
  const item = id => db.items.find(x => x.id === id).item;
  assert.equal(by('E1').status, 'auto'); assert.equal(item(by('E1').itemId), '캡 루프 실링 상태');
  assert.equal(item(by('E2').itemId), '붐 도장 흐름·오렌지필', '같은 부위·유형 둘 중 낱말이 겹치는 쪽');
  assert.equal(item(by('E3').itemId), '붐 도막 두께');
  assert.equal(by('E4').status, 'nopart');
  assert.equal(by('E5').status, 'notype'); assert.equal(by('E5').type, '녹·부식');
  assert.equal(by('E6').status, 'unknown'); assert.equal(by('E6').part, '엔진후드');
  assert.equal(item(by('E7').itemId), '붐 배관 간섭');
});
test('직접 연결이 자동보다 앞섬 — 항목·신규 후보·제외, 지운 항목은 무시', () => {
  const db = tinyDb();
  const e6 = db.issues.find(x => x.no === 'E6'), e1 = db.issues.find(x => x.no === 'E1'), e5 = db.issues.find(x => x.no === 'E5');
  const decal = db.items.find(x => x.category === '데칼·표시');
  db.links[e6.id] = decal.id; db.links[e1.id] = 'skip'; db.links[e5.id] = 'new';
  let m = L.matchAll(db);
  assert.equal(m[e6.id].status, 'manual'); assert.equal(m[e6.id].type, '데칼·표시');
  assert.equal(m[e1.id].status, 'skip'); assert.equal(m[e5.id].status, 'new');
  db.links[e6.id] = 'C999';
  m = L.matchAll(db);
  assert.equal(m[e6.id].status, 'unknown', '없는 항목 id 는 자동으로');
  const s = L.matchSummary(db.issues, m);
  assert.equal(s.total, 7); assert.equal(s.skip, 1); assert.equal(s.linked + s.review + s.skip + (s.by.new || 0), 7);
});
test('신규 항목 후보 — (부위·유형) 묶음, 더하면 이어짐', () => {
  const db = tinyDb();
  db.issues.push(Object.assign({}, db.issues.find(x => x.no === 'E4'), { id: 'I0099', model: 'T-3', date: '2026-05-01', content: '공구함 도어 갭 불균일' }));
  let m = L.matchAll(db);
  const c = L.candidates(db, m);
  assert.equal(c.length, 2);
  assert.equal(c[0].part, '공구함'); assert.equal(c[0].type, '단차·갭'); assert.equal(c[0].n, 2); assert.deepEqual(c[0].models, ['T-2', 'T-3']);
  assert.equal(c[0].suggest.item, '공구함 단차·갭');
  const nu = L.newItemFrom(db, c[0]);
  assert.equal(nu.id, 'C007'); assert.equal(nu.added, true);
  db.items.push(nu);
  m = L.matchAll(db);
  assert.equal(L.candidates(db, m).length, 1, '공구함 묶음은 자동으로 새 항목에 이어짐');
  assert.ok(db.issues.filter(x => x.part === '공구함').every(x => m[x.id].status === 'auto' && m[x.id].itemId === 'C007'));
});

console.log('점수');
test('점수 — 손으로 계산한 값과 같음(빈도·최근성·심각도)', () => {
  const db = L.emptyDb();
  db.items = [{ id: 'C001', part: '캡', item: '캡 실링', category: '실링' }, { id: 'C002', part: '캡', item: '캡 도장', category: '도장' }, { id: 'C003', part: '캡', item: '캡 데칼', category: '데칼·표시' }];
  db.issues = [
    { id: 'I1', model: 'A', date: '2026-01-01', part: '캡', content: '누수', severity: '상' },
    { id: 'I2', model: 'A', date: '2025-01-01', part: '캡', content: '누수', severity: '하' },
    { id: 'I3', model: 'B', date: '2026-01-01', part: '캡', content: '도장 흐름', severity: '중' }
  ];
  const rows = L.scoreItems(db, L.matchAll(db));
  const r1 = rows.find(r => r.id === 'C001'), r2 = rows.find(r => r.id === 'C002'), r3 = rows.find(r => r.id === 'C003');
  assert.equal(rows.refDate, '2026-01-01');
  // C001: 빈도 2, 최근성 1 + 0.5^(365/365)=1.5, 심각도 3+1=4 → 모두 최댓값 → 100
  assert.equal(r1.score, 100);
  // C002: 빈도 1/2=50, 최근성 1/1.5=66.67, 심각도 2/4=50 → (40·50 + 30·66.67 + 30·50)/100 = 55
  assert.equal(r2.score, 55);
  assert.equal(r3.score, 0); assert.equal(r3.tier, '생략 후보');
  assert.equal(r1.tier, '중점'); assert.equal(r2.tier, '중점');
  assert.deepEqual(r1.sevCount, { '상': 1, '중': 0, '하': 1 }); assert.equal(r1.recentN, 2, '기준일에서 365일째도 최근'); assert.equal(r1.lastDate, '2026-01-01');
  db.settings = L.cleanSettings({ weights: { freq: 0, recent: 0, sev: 100 }, focusMin: 60 });
  const rows2 = L.scoreItems(db, L.matchAll(db));
  assert.equal(rows2.find(r => r.id === 'C002').score, 50, '심각도만 보면 2/4');
  assert.equal(rows2.find(r => r.id === 'C002').tier, '일반', '기준 60 미만');
});
test('필수 항목·신규 부품 부위는 이슈 0건이어도 생략 후보가 아님', () => {
  const db = tinyDb(), m = L.matchAll(db);
  const decal = L.scoreItems(db, m).find(r => r.item.required);
  assert.equal(decal.n, 0); assert.equal(decal.tier, '일반');
  const t = { name: 'N', kind: '굴착기', size: '중형', newParts: true, newPartList: ['붐'] };
  const rows = L.scoreItems(db, m, { target: t });
  assert.ok(rows.filter(r => r.item.part === '붐').every(r => r.newPart && r.tier !== '생략 후보'));
});
test('모델 특성 거르기 — 고른 특성의 모델 이슈만', () => {
  const db = tinyDb(), m = L.matchAll(db);
  const all = L.scoreItems(db, m).reduce((s, r) => s + r.n, 0);
  const onlyNew = L.scoreItems(db, m, { filter: { newParts: true } });
  assert.equal(all, 4, 'E1·E2·E3·E7 이 이어짐');
  assert.equal(onlyNew.reduce((s, r) => s + r.n, 0), 2, 'T-1 의 E1·E2');
  assert.equal(onlyNew.excluded, 2);
  assert.equal(L.scoreItems(db, m, { filter: { kind: '휠로더' } }).reduce((s, r) => s + r.n, 0), 1);
});
test('닮은 정도 — 특성이 다르면 반영률을 곱함', () => {
  const sim = { kind: 0.5, size: 0.7, newParts: 0.5 };
  const t = { kind: '굴착기', size: '대형', newParts: true };
  assert.equal(L.similarity({ kind: '굴착기', size: '대형', newParts: true }, t, sim), 1);
  assert.equal(L.similarity({ kind: '휠로더', size: '대형', newParts: true }, t, sim), 0.5);
  assert.equal(L.round(L.similarity({ kind: '휠로더', size: '중형', newParts: false }, t, sim), 3), 0.175);
  assert.equal(L.round(L.similarity({}, t, sim), 3), 0.175, '모르는 특성은 다른 것으로');
  assert.equal(L.similarity({ kind: '휠로더' }, null, sim), 1, '신규 모델이 없으면 모두 1');
});
test('설정 정리 — 범위 밖 값은 기본값, 가중치 합 0 이면 기본', () => {
  const s = L.cleanSettings({ weights: { freq: 0, recent: 0, sev: 0 }, halfLifeDays: 5, sim: { kind: 3 }, focusMin: 55 });
  assert.deepEqual(s.weights, L.DEFAULT_SETTINGS.weights);
  assert.equal(s.halfLifeDays, 365); assert.equal(s.sim.kind, 0.5); assert.equal(s.focusMin, 55);
  assert.ok(s.partSynonyms['캡'] && s.typeKeywords['도장']);
});

console.log('신규 모델 체크시트 · 리포트 (가상 샘플)');
test('샘플 — 62항목·146건·모델 8개, 연결 90% 이상', () => {
  const db = sampleDb(), m = L.matchAll(db), s = L.matchSummary(db.issues, m);
  assert.equal(db.items.length, 62); assert.equal(db.issues.length, 146); assert.equal(Object.keys(db.models).length, 8);
  assert.ok(s.linked / s.total >= 0.9, '연결 ' + s.linked + '/' + s.total);
  assert.equal(s.by.unknown, 2, '유형 못 찾는 이슈 2건(직접 연결 연습용)');
});
test('샘플에 심은 모양 ① — 신규 부품 모델에서 실링·간섭이 1대당 3배 넘게 많음', () => {
  const db = sampleDb(), cmp = L.compareBy(db, L.matchAll(db), 'newParts');
  const g = k => cmp.groups.find(x => x.key === k);
  const per = (k, t) => g(k).byType.find(x => x.type === t).perModel;
  assert.equal(g('신규 부품 있음').models.length, 4); assert.equal(g('신규 부품 없음').models.length, 4);
  assert.ok(per('신규 부품 있음', '실링') >= 3 * per('신규 부품 없음', '실링'), '실링 ' + per('신규 부품 있음', '실링') + ' vs ' + per('신규 부품 없음', '실링'));
  assert.ok(per('신규 부품 있음', '간섭') >= 2 * per('신규 부품 없음', '간섭'), '간섭');
  assert.ok(Math.abs(per('신규 부품 있음', '도장') - per('신규 부품 없음', '도장')) <= 2.5, '도장은 비슷');
});
test('샘플에 심은 모양 ② — 도장 항목이 모델 5개 이상에서 되풀이', () => {
  const db = sampleDb(), rows = L.scoreItems(db, L.matchAll(db));
  const rep = L.repeatItems(rows, 5);
  assert.ok(rep.filter(r => r.item.category === '도장').length >= 3, rep.map(r => r.item.item).join(', '));
});
test('샘플에 심은 모양 ③ — 체크시트에 없는 이슈: 공구함·배터리커버·캡도어 녹', () => {
  const db = sampleDb(), c = L.candidates(db, L.matchAll(db));
  const keys = c.map(g => g.part + '|' + g.type).sort();
  assert.deepEqual(keys, ['공구함|간섭', '공구함|단차·갭', '배터리커버|녹·부식', '캡도어|녹·부식']);
  assert.equal(c.reduce((s, g) => s + g.n, 0), 10);
});
test('신규 모델 체크시트 — 중점 → 일반 → 생략 후보 순, 신규 후보는 끝', () => {
  const db = sampleDb(), m = L.matchAll(db), o = L.optimizeChecklist(db, m, Sample.TARGET);
  const tiers = o.rows.map(r => L.TIER_ORDER[r.tier]);
  assert.deepEqual(tiers, tiers.slice().sort((a, b) => a - b), '구분 순서');
  const focus = o.rows.filter(r => r.tier === '중점');
  assert.ok(focus.length >= 5);
  for (let i = 1; i < focus.length; i++) assert.ok(focus[i - 1].score >= focus[i].score, '중점 안은 점수 순');
  assert.equal(o.count['중점'] + o.count['일반'] + o.count['생략 후보'], 62);
  assert.equal(o.count['신규 후보'], 4);
  assert.ok(o.rows.filter(r => r.item.required).every(r => r.tier !== '생략 후보'), '필수 항목은 생략 안 함');
  assert.ok(o.rows.filter(r => r.newPart).every(r => r.tier !== '생략 후보'), '신규 부품 부위(캡·캡도어)는 생략 안 함');
  const aoa = L.checklistToAoa(o, false);
  assert.deepEqual(aoa[3], L.SHEET_HEAD);
  assert.equal(aoa.length - 4, o.count['중점'] + o.count['일반'] + o.count['신규 후보'], '생략 후보 빼고 내보냄');
  assert.equal(L.checklistToAoa(o, true).length - 4, 62 + 4);
  assert.equal(aoa[aoa.length - 1][1], '신규 후보');
});
test('신규 부품 대형 굴착기는 실링·간섭 항목이 더 앞으로', () => {
  const db = sampleDb(), m = L.matchAll(db);
  const rankOf = (t, cat) => { const rows = L.scoreItems(db, m, { target: t }); const r = rows.filter(x => x.item.category === cat).slice(0, 3); return r.reduce((s, x) => s + x.rank, 0) / r.length; };
  const newT = { name: 'A', kind: '굴착기', size: '대형', newParts: true, newPartList: [] };
  const oldT = { name: 'B', kind: '굴착기', size: '대형', newParts: false, newPartList: [] };
  assert.ok(rankOf(newT, '실링') < rankOf(oldT, '실링'), '실링 평균 순위 ' + rankOf(newT, '실링') + ' < ' + rankOf(oldT, '실링'));
  assert.ok(rankOf(newT, '간섭') < rankOf(oldT, '간섭'));
});
test('리포트 — 상위 N개, 근거 글, 특성 비교·되풀이·후보 포함', () => {
  const db = sampleDb(), m = L.matchAll(db), rep = L.buildReport(db, m, Sample.TARGET);
  assert.equal(rep.top.length, 10);
  assert.ok(rep.top.every(r => r.n > 0));
  assert.equal(rep.range.issues, 146); assert.equal(rep.range.models, 8);
  assert.match(rep.text, /우려 포인트 상위 10개/);
  assert.match(rep.text, /신규 부품 있음 \(모델 4개\)/);
  assert.match(rep.text, /공구함 · 단차·갭: 2건/);
  assert.match(L.evidenceText(rep.top[0]), /^\d+건\(.+\) · 모델 \d+개 · 최근 \d{4}-\d\d-\d\d/);
});

console.log('AI 프롬프트 · 모델 이름 가리기');
test('별칭 — 같은 모델은 늘 같은 별칭, 새 모델만 다음 번호', () => {
  const a = L.assignAliases({}, ['X-100', 'X-120']);
  assert.deepEqual(a, { 'X-100': '모델1', 'X-120': '모델2' });
  assert.deepEqual(L.assignAliases(a, ['X-160', 'X-100']), { 'X-100': '모델1', 'X-120': '모델2', 'X-160': '모델3' });
});
test('가리기·되돌리기 — 글 속 모델 이름, 「모델 3개」는 그대로', () => {
  const map = { 'X-100': '모델1', 'X-1000': '모델2', 'W-20': '모델3' };
  assert.equal(L.maskText('X-100 과 X-1000, (W-20) 비교', map), '모델1 과 모델2, (모델3) 비교');
  assert.equal(L.maskText('AX-100 은 다른 것', map), 'AX-100 은 다른 것');
  assert.equal(L.unmaskText('모델1 은 실링, 모델2·모델3 도 / 모델 3개 · 모델3개 · 모델3대', map), 'X-100 은 실링, X-1000·W-20 도 / 모델 3개 · 모델3개 · 모델3대');
  assert.deepEqual(L.findLeaks('X-100 남음, X-1000X 아님', ['X-100', 'X-160']), ['X-100']);
});
test('프롬프트 — 가리면 실제 모델 이름 0개, 근거 숫자는 그대로', () => {
  const db = sampleDb(), m = L.matchAll(db), rep = L.buildReport(db, m, Sample.TARGET);
  const names = L.modelNames(db.issues).concat([Sample.TARGET.name]);
  const al = L.assignAliases({}, names);
  const info = L.buildAiPromptInfo(rep, al);
  assert.deepEqual(info.leaks, []);
  names.forEach(n => assert.ok(info.prompt.indexOf(n) < 0, n + ' 이 남음'));
  assert.ok(info.prompt.indexOf(al['X-180(개발 중)']) >= 0, '신규 모델도 별칭');
  assert.ok(info.prompt.indexOf(rep.top[0].item.item) >= 0 && info.prompt.indexOf('점수 ' + rep.top[0].score) >= 0);
  assert.ok(Object.keys(info.map).length >= 8);
  const plain = L.buildAiPromptInfo(rep, null);
  assert.ok(plain.prompt.indexOf('X-120') >= 0, '가리지 않으면 이름 그대로');
  assert.equal(L.unmaskText(info.prompt, al).indexOf('X-120') >= 0, true, '되돌리면 이름이 돌아옴');
});

console.log('저장 · 엑셀');
test('저장 형식 — 되살리기, 이상한 값은 걸러냄, 기본은 가리기 켬', () => {
  assert.equal(L.emptyDb().maskModels, true);
  const db = sampleDb(); db.links = { I0001: 'skip', bad: 3 }; db.target = Sample.TARGET;
  const back = L.restoreDb(JSON.parse(JSON.stringify(db)));
  assert.equal(back.items.length, 62); assert.equal(back.issues.length, 146);
  assert.deepEqual(back.links, { I0001: 'skip' });
  assert.deepEqual(back.target.newPartList, ['캡', '캡도어']);
  assert.equal(L.restoreDb({ maskModels: false }).maskModels, false);
  assert.equal(L.restoreDb(null).items.length, 0);
});
test('엑셀 왕복 — 샘플 파일을 SheetJS 로 다시 읽어도 같은 결과', () => {
  const f1 = new URL('../samples/' + Sample.FILES.checklist, import.meta.url), f2 = new URL('../samples/' + Sample.FILES.issues, import.meta.url);
  const read = f => { const wb = XLSX.read(fs.readFileSync(f), { type: 'buffer', cellDates: true }); return wb.SheetNames.map(n => ({ name: n, aoa: XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null }) })); };
  const s1 = read(f1), s2 = read(f2);
  const items = L.parseChecklist(L.pickSheet(s1, 'checklist').aoa).items;
  const issues = L.parseIssues(L.pickSheet(s2, 'issues').aoa).issues;
  const direct = L.parseIssues(Sample.issuesAoa()).issues;
  assert.equal(items.length, 62);
  assert.deepEqual(issues.map(x => x.date + x.part + x.severity), direct.map(x => x.date + x.part + x.severity), '날짜 칸(엑셀 날짜)이 하루 밀리지 않음');
  assert.equal(Object.keys(L.parseModels(L.pickSheet(s2, 'models').aoa).models).length, 8);
});

const { versions } = await import('../scripts/bump-version.mjs');
test('판 맞추기 — index.html ?v= · logic.js · app.js 가 같은 판 (scripts/bump-version.mjs)', () => {
  const v = versions();
  assert.equal(v.logic, L.VERSION, 'logic.js VERSION'); assert.equal(v.app, L.VERSION, 'app.js APP_VERSION');
  assert.ok(v.html.length >= 8 && v.html.every(x => x === L.VERSION), 'index.html 의 모든 js·css 에 ?v=' + L.VERSION + ' — ' + JSON.stringify(v.html));
});

console.log('\n' + passed + '개 통과' + (process.exitCode ? ' — 실패 있음' : ''));
