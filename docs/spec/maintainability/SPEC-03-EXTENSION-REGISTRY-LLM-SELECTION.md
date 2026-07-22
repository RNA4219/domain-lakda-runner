---
document_id: LAKDA-SPEC-MNT-003
status: review-ready
version: 0.1.0-draft
last_updated: 2026-07-22
requirements: ../../../REQUIREMENTS-MAINTAINABILITY.md
checklist: CHECKLIST-03-EXTENSION-REGISTRY-LLM-SELECTION.md
---

# SPEC-03 Extension Registry / LLM Selection

対応チェックリスト: [CHECKLIST-03](CHECKLIST-03-EXTENSION-REGISTRY-LLM-SELECTION.md)

## Objective

拡張点を組み込みallowlist registryへ集約し、LLMを安全なcandidate選択または停止だけに限定する。

## Primary owner IDs

REQ-MNT-EXT-001, REQ-MNT-EXT-002, REQ-MNT-EXT-003, REQ-MNT-EXT-004, REQ-MNT-EXT-005, REQ-MNT-EXT-006, REQ-MNT-EXT-007, REQ-MNT-EXT-008

## Contract

- Adapter registryは`playwright`、`airtest-poco`、`security`をID、capability、factoryで解決する。Airtest/PocoとSecurityはoperator管理loopback endpointだけを使い、processを起動しない。
- Generator registryは組み込みstrategyだけを解決し、全strategyへstable candidate sort、単一seed、最新Observation、Safety Policy適用済み集合を渡す。
- Oracle registryはgeneric、宣言型product contract、security candidateの結果を別々に保持する。product contractはデータであり任意codeではない。
- `llm-select` requestはschema/version、safe candidate ID、redacted graph summary、budgetだけを含む。responseは`select`または`stop`のstrict JSONとし、additional propertyと提示外IDを拒否する。
- selector、URL、input、path、code、command、Safety Policy変更、pass/fail、脆弱性確定、QEG verdictをLLMへ要求または受理しない。
- LLM unavailable、timeout、schema/model不一致時はrandom等へfallbackせず、`partial`、`llm_error`、attestation/digest/reject reasonを保存して停止する。
- registry refactorで既存5 mode、config、trace、replay、終了codeを変更しない。

## Plan

1. built-in registryとcapability contractを追加する。
2. Adapter/Generator/Oracleの既存分岐をregistryへ移す。
3. strict `llm-select` request/responseと停止結果を実装する。
4. deterministic/negative/既存mode回帰を固定する。

## Patch

- CLIからmodule pathまたはplugin packageを指定できない。
- LLM failureをsilent fallbackで隠さない。
- Oracle resultとGenerator selectionを同じ型へ混在させない。

## Tests

- 未知ID、capability mismatch、loopback外endpoint、任意module path拒否。
- 提示外candidate、extra key、selector/URL/command、timeout、explicit stop。
- 全Generatorの同一seed byte-identical selection。
- 既存5 mode、trace、replayの回帰。

## Commands

- `npm run test:contracts`
- `npm run acceptance:adaptive`
- `npm test`

## Notes

AC-MNT-005、AC-MNT-006の完了には`llm-select`がrandom互換実装ではないことをnegative testで証明する。
