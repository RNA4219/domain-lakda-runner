# Lakda拡張 Checklist-03: Investigation/Promotion/Evidence

## A. 仕様・実装前

- [x] strict replayを1回に固定し、divergenceをfail-closedにした
- [x] reproduced以外のpromoteを拒否し、parent digestを保持する
- [x] shrinkingのmutation/scope/budget/kill switchを定義した
- [x] KPIを分子・分母・revisionで保存する
- [x] P11をreal executionMode、revision/config digest、Oracle/HATE refs、pending_externalへ固定した

## B. ローカル実証

- [x] replay divergence、reproduced-only promote、parent digestを検証した
- [x] shrinkingとKPIを検証した
- [x] P11未設定runner/verifierが非0かつpending_externalになることを検証した
- [x] HATE/v1 export経路とredaction/scan契約を再利用した

## C. 外部・残課題

- [ ] 承認済みtargetでP11 case runnerを実行する（pending_external）
- [ ] real HATE artifact refsを最終manifestで照合する（external）
- [ ] manual-bb/QEG handoffを外部工程で完了する（external）
