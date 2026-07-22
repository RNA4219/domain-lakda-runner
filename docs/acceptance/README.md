---
document_id: LAKDA-ACCEPTANCE-INDEX-001
status: active
last_updated: 2026-07-22
---

# 受入・実環境索引

## 実環境runbook

- [P7 real acceptance](P7-REAL-ACCEPTANCE-RUNBOOK.md) — approved target、immutable corpus、全case、HATE、manual-bb/QEG境界

## 現在の資格

- [P11 pending external](AC-20260715-17.lakda-extension-p11-pending-external.md)
- [Lakda extension release validation](AC-20260716-18.lakda-extension-release-validation.md)
- [reference staging QEG go](AC-20260716-19.reference-staging-qeg-go.md) — 記載revisionだけに有効

## 読み方

- `fixture`、`mock`、`simulated`は補助証跡であり、real targetの完了証跡ではない。
- Acceptance recordのGo/QEG結果はrecordに固定されたsource revision、environment、artifact digestへだけ適用する。
- current sourceのrelease判断は[current release profile](../../release-profiles/current.json)を用いて新規にGateを実行する。
- LakdaはHATE/v1までを生成し、manual-bb/QEGのverdictを代行しない。

この索引は既存Acceptance artifactを改変せず、入口と資格だけを説明する。
