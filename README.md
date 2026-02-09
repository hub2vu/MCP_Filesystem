"# MCP_Filesystem" 
1) 공식/레퍼런스 계열 (가장 기본으로 많이 깔림)

Anthropic/modelcontextprotocol 쪽 레퍼런스 서버로 자주 쓰는 것들:

Filesystem: 안전한 파일 읽기/쓰기(경로 제한 걸고)

Git: 레포 읽기/검색/간단 조작

Fetch: 웹 페이지 가져와서 LLM이 쓰기 좋은 형태로 변환

Memory: 지식그래프 기반 “지속 메모리”

Time: 시간/타임존 변환

Sequential Thinking: 단계적 사고(프롬프트/툴) 지원


이건 “다들 설치해보는 기본 세트” 느낌이라 사용량이 많아.

2) 커뮤니티에서 실제 업무에 많이 붙이는 계열

“Awesome MCP Servers”류 리스트들에서 꾸준히 상위로 보이는 범용 조합:

DB: SQLite / PostgreSQL / MySQL (데이터 조회·리포트)

DevOps: Kubernetes(kubectl), 클러스터 상태/배포/로그

개발 워크플로우: GitHub(이슈/PR/리뷰/자동화)

Aggregator(허브형): 여러 SaaS를 한 서버로 묶어 SQL/워크플로우로 접근(예: anyquery, pipedream 계열)

기타 생산성 앱 연동: Notion/Slack/Jira 같은 류(리스트에 매우 많이 등장)