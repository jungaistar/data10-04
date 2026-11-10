// 로그인 설정 — 이 파일 한 곳만 바꾸면 된다(생성: data10-00/scripts/apply-auth-kit.mjs, 대문 문구 출처 docs/plan.json).
// 내 Supabase 로 옮길 때: url · anonKey 를 내 프로젝트 값으로, 카카오를 설정하지 않았으면 kakao: false. 안내 = docs/내_깃허브로_옮기기.md
// prefix 는 supabase/auth.sql 의 표 이름 앞부분과 같아야 한다.
window.AUTH_CONFIG = {
  "url": "https://hcmgdztsgjvzcyxyayaj.supabase.co",
  "anonKey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhjbWdkenRzZ2p2emN5eHlheWFqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE0MzU4ODcsImV4cCI6MjA4NzAxMTg4N30.gznaPzY1l8qDAPsEyYNR9KS7f7VqS3xaw-_2HTSwSZw",
  "prefix": "data1004",
  "kakao": true,
  "idleMinutes": 30,
  "localBypass": true,
  "site": {
    "title": "개발장비 외관평가 Agent",
    "summary": "외관검사 체크시트와 이슈 리스트를 이어 항목별 이슈 빈도 · 위험 점수를 내고, 신규 개발모델용 체크시트와 이슈 발생 우려 포인트 리포트를 만드는 도구입니다.",
    "course": "현장 데이터 디지털화 전문가과정 · 2차수",
    "features": [
      {
        "name": "이슈 매칭",
        "desc": "부위 이름을 맞추고(CAB = 캐빈 = 캡) 이슈 내용의 낱말로 유형을 찾아 체크 항목에 잇습니다."
      },
      {
        "name": "항목별 위험 점수",
        "desc": "빈도 · 최근성 · 심각도를 합친 0~100 점수를 내고 기종 · 크기 · 신규 부품으로 거릅니다."
      },
      {
        "name": "신규 모델 체크시트",
        "desc": "신규 모델 특성으로 위험 항목을 앞으로 올려 중점 · 일반 · 생략 · 신규 후보로 나눕니다."
      },
      {
        "name": "우려 포인트 리포트",
        "desc": "상위 우려 포인트와 근거 숫자, 되풀이 항목, 신규 항목 후보를 정리합니다."
      },
      {
        "name": "데이터 가져오기",
        "desc": "체크시트 · 이슈 리스트 엑셀, 머리행 자동 찾기, 열 연결, 중복 제거, 모델 정보 시트."
      },
      {
        "name": "체크시트 마스터",
        "desc": "부위 · 점검 항목 · 검사 방법 · 판정 기준을 더하고 고치며 항목별 연결 이슈 수를 봅니다."
      }
    ],
    "steps": [
      "로그인 · 승인",
      "엑셀 넣기",
      "이슈 잇기",
      "위험 점수",
      "신규 모델 맞춤",
      "리포트 · 내보내기"
    ],
    "flow": [
      {
        "step": "로그인 · 승인",
        "desc": "가입 · 사용 신청 뒤 관리자가 승인하면 도구가 열림"
      },
      {
        "step": "엑셀 넣기",
        "desc": "체크시트 · 이슈 리스트(모델 정보 시트) 엑셀, 열 연결"
      },
      {
        "step": "이슈 잇기",
        "desc": "부위 사전 + 유형 낱말로 체크 항목에 연결, 못 이은 것은 직접"
      },
      {
        "step": "위험 점수",
        "desc": "빈도 · 최근성(반감기) · 심각도 가중 점수 0~100"
      },
      {
        "step": "신규 모델 맞춤",
        "desc": "모델 특성으로 닮은 모델 이슈를 더 무겁게, 중점 · 생략 · 신규"
      },
      {
        "step": "리포트 · 내보내기",
        "desc": "우려 포인트 리포트, 체크시트 엑셀 · 인쇄 · Word"
      }
    ],
    "goals": [
      "이슈 리스트를 체크시트 항목에 이어 항목마다 실제 이슈 빈도를 보입니다.",
      "개발모델 특성에 따라 체크시트를 최적화합니다 — 중점 · 일반 · 생략 후보 · 신규 항목 후보.",
      "신규 개발모델의 이슈 발생 우려 포인트를 근거 숫자와 함께 냅니다."
    ],
    "screen": "docs/img/screen.png",
    "plan": "plan.html",
    "home": true,
    "landing": {
      "colors": {
        "navy": "#0f2f3a",
        "navy2": "#0a2129",
        "brand": "#0b6f78",
        "brandDark": "#095860",
        "accent": "#6fd6d0"
      }
    }
  }
};
