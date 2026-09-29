# Bloom Budget — 우리집 자산관리

병호·영원 부부가 예산, 수입, 소비 지출, 대출과 상환을 함께 관리하는 반응형 웹앱입니다.

## 로컬 실행

1. `.env.example`을 `.env`로 복사하고 `DATABASE_URL`, `APP_PASSWORD`, `SESSION_SECRET`을 설정합니다.
2. `docker compose up -d`로 PostgreSQL을 시작합니다.
3. `npm install` 후 `npm start`를 실행합니다.
4. `http://localhost:3000`에서 병호 또는 영원을 선택해 로그인합니다.

`APP_PASSWORD=051711`로 설정하면 요청한 공용 비밀번호를 사용합니다. 실제 인터넷 배포에서는 더 긴 비밀번호로 변경하세요.

## 주요 기능

- 월별 예산과 소비유형별 집행률
- 수입·지출 등록 및 최근 내역
- 대출 등록, 원금·이자 상환 기록, 잔액 진행률
- Gemini 모델 선택과 API 연결 테스트
- PostgreSQL 관계형 스키마와 Docker 개발환경

## GitHub 업로드

이 폴더 전체를 새 저장소에 올리면 됩니다. `.env`는 `.gitignore`에 포함되어 API 키와 비밀번호가 커밋되지 않습니다.

## Vercel 배포

저장소 전체를 Vercel 프로젝트로 연결하면 `vercel.json`이 `dist` 폴더를 자동으로 배포합니다. Vercel의 Framework Preset은 `Other`를 사용하고 Root Directory는 비워 둡니다. 배포 후 화면, 데모 로그인, 기기 저장 기능이 동작합니다.

PostgreSQL과 Gemini API는 정적 배포만으로 실행되지 않습니다. 운영 서버 기능을 사용하려면 별도 Node.js 백엔드를 배포하고 `DATABASE_URL`, `APP_PASSWORD`, `SESSION_SECRET`, `GEMINI_API_KEY` 환경변수를 설정해야 합니다.

