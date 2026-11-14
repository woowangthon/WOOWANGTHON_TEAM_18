-- 운영자 "정리"(소프트 삭제): 운영자 목록에서 프로젝트를 숨긴 시각. null이면 숨기지 않았다.
-- 숨김은 이 시각이 프로젝트의 가장 최근 배포보다 나중일 때만 유효하다(다시 배포하면 목록에 돌아온다). 클러스터 객체는 지우지 않는다.
alter table public.projects add column hidden_at timestamptz;
