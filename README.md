# Bloom Budget — 우리집 자산관리

병호·영원 부부가 예산, 수입, 소비 지출, 대출과 상환을 함께 관리하는 반응형 웹앱입니다.

## 로컬 실행

1. `.env.example`을 `.env`로 복사하고 `DATABASE_URL`, `APP_PASSWORD`, `SESSION_SECRET`을 설정합니다.
2. Neon 콘솔의 연결 문자열을 `DATABASE_URL`에 입력합니다.
3. `npm install` 후 `npm start`를 실행합니다.
4. `http://localhost:3000`에서 병호 또는 영원을 선택해 로그인합니다. 첫 API 요청 때 스키마와 기본 소비유형이 자동 생성됩니다.

`APP_PASSWORD=051711`로 설정하면 요청한 공용 비밀번호를 사용합니다. 실제 인터넷 배포에서는 더 긴 비밀번호로 변경하세요.

## 주요 기능

- 월별 예산과 소비유형별 집행률
- 예산·수입·지출·대출·상환 전체 내역 조회와 추가·수정·삭제
- 관리 년월 기준 대시보드 집계와 실제 사용일 관리
- Gemini 모델 선택과 API 연결 테스트
- PostgreSQL 관계형 스키마와 Docker 개발환경

## GitHub 업로드

이 폴더 전체를 새 저장소에 올리면 됩니다. `.env`는 `.gitignore`에 포함되어 API 키와 비밀번호가 커밋되지 않습니다.

## Vercel 배포

저장소 전체를 Vercel 프로젝트로 연결합니다. Framework Preset은 자동 감지되는 `Express`를 사용하고 Root Directory는 비워 둡니다. `public`은 정적 화면으로, 루트 `index.js`는 API 서버로 배포됩니다.

Vercel 프로젝트의 Environment Variables에 `DATABASE_URL`, `APP_PASSWORD`, `SESSION_SECRET`을 등록해야 합니다. `APP_PASSWORD`는 요청한 `051711`, `SESSION_SECRET`은 충분히 긴 임의 문자열을 사용합니다. Gemini 키를 서버에 둘 경우에만 `GEMINI_API_KEY`도 등록합니다.

