---
document_id: LAKDA-SPEC-MNT-002
status: review-ready
version: 0.1.0-draft
last_updated: 2026-07-22
requirements: ../../../REQUIREMENTS-MAINTAINABILITY.md
checklist: CHECKLIST-02-REAL-ACCEPTANCE-CORE.md
---

# SPEC-02 Real Acceptance Core

対応チェックリスト: [CHECKLIST-02](CHECKLIST-02-REAL-ACCEPTANCE-CORE.md)

## Objective

P7/P11に重複するpreflight、digest、HATE再照合を共通化し、対象へ接続する前のfail-closed境界を同一にする。

## Primary owner IDs

REQ-MNT-ACC-001, REQ-MNT-ACC-002, REQ-MNT-ACC-003, REQ-MNT-ACC-004, REQ-MNT-ACC-005, REQ-MNT-ACC-006

## Contract

- 共通coreはschema validation、stable-key canonical digest、corpus/case lookup、target manifest検証、config/revision照合、HATE manifestのportable path・bytes・size・SHA-256再照合を提供する。
- preflight順はconfirmation、corpus/case、target manifest、approval/scope、revision/config digest、mutation、settle policy、接続で固定する。
- 入力欠落と契約不成立はtargetへ接続せず`pending_external`、exit 2とする。内部I/Oまたは実装障害はexit 1、case成功だけをexit 0とする。
- P11の新規生成reportは`lakda/extension-acceptance-case/v2`とし、target manifest ID/SHA-256、candidate audit、coverage debtを持つ。P0/P1候補欠落または未分類controlがあればpassにしない。
- P7の公開report/schema/exit契約は維持する。P11 verifierはv2を正本とし、保存済みv1を読取専用で検証できる。
- HATE refは文字列の存在だけで受理せず、最終manifestから相対pathを解決して実bytesを再計算する。path traversal、欠落、digest不一致を拒否する。
- Lakdaはmanual-bbまたはQEG verdictを生成しない。

## Plan

1. 重複helperを`src/acceptance`へ移す。
2. P7を出力互換のまま共通coreへ移行する。
3. P11 v2、target manifest、candidate auditを接続する。
4. v1読取互換とtamper negativeを固定する。

## Patch

- target接続前処理に副作用を持ち込まない。
- 保存済みv1 artifactを変換・上書きしない。
- mock/fixture reportをrealへ昇格しない。

## Tests

- confirmation/corpus/case/manifest/revision/config/mutation/settle欠落で接続0回。
- exit 0/1/2と`pending_external`の分類。
- P11 v2 candidate audit、P0/P1欠落、coverage debt。
- HATE bytes tamper、path traversal、v1読取互換。

## Commands

- `npm run test:contracts`
- `npm run acceptance:adaptive`
- P7/P11未設定runnerのexit 2確認

## Notes

AC-MNT-003、AC-MNT-004はlocal contract Gateであり、承認済みreal targetの証跡がなければ外部受入は未完了である。
