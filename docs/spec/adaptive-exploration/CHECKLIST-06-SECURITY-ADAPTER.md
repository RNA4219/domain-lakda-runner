---
document_id: LAKDA-CHK-AE-006
status: review-ready
version: 0.1.0-draft
last_updated: 2026-07-14
specification: SPEC-06-SECURITY-ADAPTER.md
---

# CHECKLIST-06 認証済み探索型Security adapter

対応仕様: [LAKDA-SPEC-AE-006](SPEC-06-SECURITY-ADAPTER.md)
要件正本: [LAKDA-REQ-002](../../../REQUIREMENTS-ADAPTIVE-EXPLORATION.md)
評価仕様: [LAKDA-EVAL-AE-001](EVALUATION-ADAPTIVE-EXPLORATION.md)

## A. 仕様完成チェック

- [x] CHK-AE-006-S-001 — 一次所有8要件が仕様節へ割り当てられている。
- [x] CHK-AE-006-S-002 — AuthorizationRecordのowner、scope、environment、期間、操作、rate、concurrency、停止連絡先が定義されている。
- [x] CHK-AE-006-S-003 — production passive-onlyとactive操作の既定denyが定義されている。
- [x] CHK-AE-006-S-004 — role/persona差分とsession/fixture不一致の除外が定義されている。
- [x] CHK-AE-006-S-005 — mutation kindと専用race schedulerが定義されている。
- [x] CHK-AE-006-S-006 — ZAP連携とscanner engine非再実装が定義されている。
- [x] CHK-AE-006-S-007 — candidate/confirmed/rejected/inconclusiveと確認flowが定義されている。
- [x] CHK-AE-006-S-008 — 停止、cleanup、証跡、HATE/QEG境界が定義されている。
- [x] CHK-AE-006-S-009 — `AC-AE-016`と評価仕様への参照がある。
- [x] CHK-AE-006-S-010 — TBD、未決定事項、孤立した一次所有要件がない。

## B. 実装・受入チェック

専用許可profile、negative fixture、real確認証跡が揃うまで未チェックとする。

| 完了 | チェックID | 要件ID | 仕様節 | 検証方法 | 証跡 |
|---|---|---|---|---|---|
| [ ] | CHK-AE-006-I-001 | REQ-SECX-001 | §3〜§10 | authorization・negative・real確認試験 | 未取得 |
| [ ] | CHK-AE-006-I-002 | REQ-SECX-002 | §3〜§10 | authorization・negative・real確認試験 | 未取得 |
| [ ] | CHK-AE-006-I-003 | REQ-SECX-003 | §3〜§10 | authorization・negative・real確認試験 | 未取得 |
| [ ] | CHK-AE-006-I-004 | REQ-SECX-004 | §3〜§10 | authorization・negative・real確認試験 | 未取得 |
| [ ] | CHK-AE-006-I-005 | REQ-SECX-005 | §3〜§10 | authorization・negative・real確認試験 | 未取得 |
| [ ] | CHK-AE-006-I-006 | REQ-SECX-006 | §3〜§10 | authorization・negative・real確認試験 | 未取得 |
| [ ] | CHK-AE-006-I-007 | REQ-SECX-007 | §3〜§10 | authorization・negative・real確認試験 | 未取得 |
| [ ] | CHK-AE-006-I-008 | REQ-SECX-008 | §3〜§10 | authorization・negative・real確認試験 | 未取得 |

## C. 受入Gate

- [ ] CHK-AE-006-A-001 — authorization欠落・期限切れ・scope不一致時のactive操作0件を確認した。
- [ ] CHK-AE-006-A-002 — productionで未許可active scan、mutation、reorder、race 0件を確認した。
- [ ] CHK-AE-006-A-003 — role差分で認証喪失・session/fixture不一致を脆弱性と誤認した件数0を確認した。
- [ ] CHK-AE-006-A-004 — raceが専用scheduler、budget、cleanup、kill switchを使用することを確認した。
- [ ] CHK-AE-006-A-005 — ZAP alertまたはLLM単独結果のconfirmed昇格0件を確認した。
- [ ] CHK-AE-006-A-006 — `AC-AE-016`でdeny、budget超過、kill switch後のactive操作0件を証明した。
- [ ] CHK-AE-006-A-007 — real証跡、redaction、HATE/v1検証、人手/明示oracle確認recordを確認した。

証跡欄にはauthorization ID、environment、mutation kind、run ID、artifact SHA-256、確認recordを記載する。
