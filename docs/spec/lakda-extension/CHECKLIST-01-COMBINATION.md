# Lakda拡張 Checklist-01: Combination

## A. 仕様・実装前

- [x] factor model/case/coverage schema versionを固定した
- [x] constraint DSLとcase budgetを固定した
- [x] Playwright selectのvisible/enabled/secret・PII除外規則を固定した
- [x] combo gen/verifyの終了条件とunknown ref拒否を固定した

## B. ローカル実証

- [x] 同一seedの生成byteが一致する
- [x] constraint充足・unsatisfiable fail-closedを検証した
- [x] pairwise/mixed-strength coverageを検証した
- [x] select optionのdisabled/hidden除外を検証した
- [x] npm run typecheck、npm run build、対象Playwright testsがpassした

## C. 外部・残課題

- [ ] 実サービスの入力値・認可差分でAC-LX-005を確認する（external）
- [ ] 実環境のcase budget・mutation policyを承認する（external）
- [ ] QEG verdictをLakda側で生成しないことを確認する（外部QEG）
