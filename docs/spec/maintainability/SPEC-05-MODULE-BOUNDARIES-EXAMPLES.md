---
document_id: LAKDA-SPEC-MNT-005
status: review-ready
version: 0.1.0-draft
last_updated: 2026-07-22
requirements: ../../../REQUIREMENTS-MAINTAINABILITY.md
checklist: CHECKLIST-05-MODULE-BOUNDARIES-EXAMPLES.md
---

# SPEC-05 Module Boundaries / Examples

対応チェックリスト: [CHECKLIST-05](CHECKLIST-05-MODULE-BOUNDARIES-EXAMPLES.md)

## Objective

肥大化した実装を責務別moduleへ分割し、利用者が安全な最小設定を再現できるsanitized exampleとcontract testを提供する。

## Primary owner IDs

REQ-MNT-MOD-001, REQ-MNT-MOD-002, REQ-MNT-MOD-003, REQ-MNT-MOD-004, REQ-MNT-MOD-005, REQ-MNT-MOD-006

## Contract

- Playwright Adapterは観測、candidate抽出、target topology、action実行、recoveryへ分割する。candidateは最新Observationとtarget identityに結び付けたまま渡す。
- Coordinatorはruntime setup、observe/select/execute loop、oracle、recovery、shrinkingへ分割し、Safety Policyとhard capを共通境界として先に適用する。
- Combinationはmodel/constraint、generator、verifierへ、CLIはparser/dispatcherとcommand handlerへ分割する。
- 既存公開fileは互換facadeとして残し、root export、schema ID、artifact path、終了code、deterministic sequenceを変えない。module分割だけのcommitへ機能差分を混在させない。
- `examples/`はPlaywright安全設定、factor model、replay、`pending_external` target manifestを提供し、全fileをCIでschema検証する。
- exampleはsynthetic値だけを使い、credential、storageState、実PII、実入力、ready/approved real target、許可済み実originを含めない。
- packageへ含めるexample/schema/public fileをisolated installで検証する。

## Plan

1. facade下へ責務別moduleを抽出する。
2. characterisation testで分割前の公開挙動を固定する。
3. sanitized exampleとcontract test kitを追加する。
4. package contentとsecurity scanをGateへ加える。

## Patch

- 分割時にschema migrationやartifact renameを行わない。
- exampleをreal acceptance入力として配布しない。
- private helperを新しい公開APIとして暗黙exportしない。

## Tests

- facade/public export/CLI help snapshot。
- deterministic action sequence、adaptive trace、combination suiteの同等性。
- example schema、secret/PII、ready target negative。
- npm packのisolated installと必要file/不要file一覧。

## Commands

- `npm run test:contracts`
- `npm run test:examples`
- `npm run pack:check`

## Notes

AC-MNT-009、AC-MNT-010の完了後も、exampleはfixture資格に限定し、real execution evidenceとして数えない。
