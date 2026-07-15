# Lakda拡張 Checklist-02: Signal/Lead/Scout

## A. 仕様・実装前

- [x] Signalはrule-first、source ref必須、stable ID・dedupeとした
- [x] Lead capを1〜3に制限し、未調査Leadをfinding扱いにした
- [x] scout responseをstrict JSON、additional key/unknown ref拒否とした
- [x] loopback以外のprovider切替とLLMの操作権限を禁止した

## B. ローカル実証

- [x] timeout/oracle/topology/coverage/safety Signalをfixture traceから生成した
- [x] rule-only fallbackを検証した
- [x] unknown Lead/extra keyをrejectした
- [x] npm run typecheck、npm run lint、対象Playwright testsがpassした

## C. 外部・残課題

- [ ] attested loopback modelでscout JSONL evidenceを取得する（pending_external）
- [ ] 実Leadのmanual investigationを実施する（external）
- [ ] LLM usefulness/replayability KPIのrevision baselineを決める（external）
