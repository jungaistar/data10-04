// 가상 샘플 파일 만들기: node scripts/make-samples.js
// js/sample-data.js 의 체크시트 62항목과 이슈 리스트(모델 8개)를 실제 엑셀과 같은 모양의 .xlsx 2개로 씁니다(전부 지어낸 값).
// 발생일 칸은 엑셀 날짜로 넣고, 방금 쓴 파일을 앱과 같은 방식으로 다시 읽어 확인합니다.
const fs = require('fs');
const path = require('path');
const XLSX = require('../vendor/xlsx.full.min.js');
const L = require('../js/logic.js');
const Sample = require('../js/sample-data.js');

const out = path.join(__dirname, '..', 'samples');
fs.mkdirSync(out, { recursive: true });

function sheet(aoa, widths) {
  const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true, dateNF: 'yyyy-mm-dd' });
  if (widths) ws['!cols'] = widths.map(w => ({ wch: w }));
  return ws;
}
function readBack(file) {
  const wb = XLSX.read(fs.readFileSync(file), { type: 'buffer', cellDates: true });
  return wb.SheetNames.map(n => ({ name: n, aoa: XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null }) }));
}

// 1) 체크시트
const f1 = path.join(out, Sample.FILES.checklist);
const wb1 = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb1, sheet(Sample.checklistAoa(), [5, 14, 30, 16, 28, 10, 6]), '외관검사 체크시트');
fs.writeFileSync(f1, XLSX.write(wb1, { bookType: 'xlsx', type: 'buffer' }));

// 2) 이슈 리스트 + 모델 정보
const f2 = path.join(out, Sample.FILES.issues);
const wb2 = XLSX.utils.book_new();
const issues = Sample.issuesAoa().map((row, i) => i < 2 ? row : row.map((v, c) => c === 2 ? new Date(v + 'T00:00:00') : v));
XLSX.utils.book_append_sheet(wb2, sheet(issues, [8, 8, 12, 14, 36, 7, 12]), '이슈 리스트');
XLSX.utils.book_append_sheet(wb2, sheet(Sample.modelsAoa(), [8, 8, 6, 9, 24]), '모델 정보');
fs.writeFileSync(f2, XLSX.write(wb2, { bookType: 'xlsx', type: 'buffer', cellDates: true }));

// 다시 읽어 확인
const s1 = readBack(f1), c = L.parseChecklist(L.pickSheet(s1, 'checklist').aoa);
if (c.det.missing.length || c.items.length !== Sample.CHECK.length) throw new Error('체크시트 다시 읽기 실패');
const s2 = readBack(f2), p = L.parseIssues(L.pickSheet(s2, 'issues').aoa, { fileName: Sample.FILES.issues });
if (p.det.missing.length || p.warnings.length || p.issues.some(x => !/^\d{4}-\d\d-\d\d$/.test(x.date))) throw new Error('이슈 리스트 다시 읽기 실패: ' + JSON.stringify(p.warnings.slice(0, 3)));
const m = L.parseModels(L.pickSheet(s2, 'models').aoa);
if (Object.keys(m.models).length !== Sample.MODELS.length) throw new Error('모델 정보 다시 읽기 실패');
console.log(Sample.FILES.checklist, '항목', c.items.length);
console.log(Sample.FILES.issues, '이슈', p.issues.length, '· 모델', Object.keys(m.models).length, '·', p.issues[0].date, '~', p.issues[p.issues.length - 1].date);
