---
document_id: LAKDA-SPEC-LX-002
status: review-ready
version: 0.1.0-draft
last_updated: 2026-07-15
requirements: ../Lakda拡張要件定義書.md
checklist: CHECKLIST-02-SIGNAL-LLM-SCOUTING.md
evaluation: EVALUATION-LAKDA-EXTENSION.md
---

# SPEC-02 Signal・LLM scouting

## Objective

観測済みの異常兆候をrule-firstでSignal化し、LLMを既存SignalのLead synthesisに限定して利用する。LLMが利用不能でもrule-only運用を継続できる契約を定義する。

## Scope

In: ExplorationSignal、ExplorationLead、rule-first抽出、loopback LLM、strict JSON、ref allowlist、scout evidence、rule-only degradation。
Out: LLM executor、任意selector/URL/command/value、confirmed verdict、外部SaaS依存の必須化。

## Primary owner IDs

REQ-LX-SIG-001, REQ-LX-SIG-002, REQ-LX-SIG-003, REQ-LX-SIG-004, REQ-LX-SIG-005, REQ-LX-SIG-006
REQ-LX-LLM-001, REQ-LX-LLM-002, REQ-LX-LLM-003, REQ-LX-LLM-004, REQ-LX-LLM-005, REQ-LX-LLM-006, REQ-LX-LLM-007, REQ-LX-LLM-008
## Requirements

| 一次所有要件 | 契約 |
|---|---|
| REQ-LX-SIG-001〜003 | Signalはoracle、replay、timeout、topology、coverage、constraint、network、Safety拒否の観測済み事実から生成し、source refsと決定的IDを持つ。 |
| REQ-LX-SIG-004〜006 | LLMは新Signalを作らず提示済みrefだけを束ねる。Leadはexploratory findingに留め、LLM停止時はrule-onlyで継続する。 |
| REQ-LX-LLM-001〜002 | 既存loopback transport、model attestation、timeout、token budgetを継承し、redaction済みversioned contextだけを送る。 |
| REQ-LX-LLM-003〜005 | strict JSON、additionalProperties false、duplicate/unknown/non-JSON拒否、ref allowlist、selector/URL/path/code/command/raw input/confirmed verdict拒否を強制する。 |
| REQ-LX-LLM-006〜008 | providerの暗黙切替は禁止し、partialまたは設定済みrule-onlyへ遷移する。受理/拒否をJSONL証跡化し、Lead数hard capを設ける。 |

## Contract

### Signal extraction

Signalはsource run、trace、oracle、fingerprint、artifact、combination caseをID参照する。raw responseやsecretは持たない。同じsourceとfailure signatureからは同じSignal IDを生成し、重複は統合する。Signalが存在しない入力からLLMが異常を発明してはならない。

### Lead synthesis

Leadはtitle、summary、risk、signalRefs、candidateRefs、factorRefs、combinationCaseRefs、recommendedStrength、investigation statusを持つ。riskは候補の優先度であり、defectまたはvulnerabilityの確定ではない。

### LLM boundary

prompt contextはrun ID、seed、graph revision、current fingerprint summary、recent Signal summary、提示済みref、instructionを含められる。raw prompt source、cookie、credential、form value、実PII、任意selectorは含めない。

responseはschema version、decision、leadsだけを持つstrict JSONとし、ref集合外、extra key、duplicate key、non-JSON、unknown version、危険文字列をrejectする。reject後に別providerや別candidateへ暗黙切替しない。

### Degradation

LLM timeout、schema不一致、attestation不一致、loopback外endpoint、token budget超過はpartialまたは設定済みrule-onlyとして記録する。Signal、run outcome、failure evidenceは失わない。LLMが使えないことをsuccessへ変換しない。

### Evidence

受理・拒否判断はschema hash、model attestation ref、input digest、output digest、reject reason、run revisionをredaction済みJSONLへ記録する。raw promptとraw responseは保存しない。

## Public I/O

| command | 必須入力 | 出力 | 失敗 |
|---|---|---|---|
| lakda scout | config、suite、scout config | signals、leads、scout log、report refs | schema/ref/attestation/timeout error |
| lakda report leads | run directory | lead report JSON/HTML | unknown run/artifact、非0 |

scoutはLLMなしでもrule-only modeを明示的に実行できる。provider切替、Safety Policy変更、candidate生成はscoutの権限外とする。

## Scenarios

- 正常: timeoutとreplay divergenceの既存SignalをLeadへ束ね、source refsが追跡できる。
- 境界: Lead数hard capを超えるresponseを全体rejectまたは設定済みtruncationとして証跡化する。
- 異常: unknown ref、extra key、duplicate key、non-JSONを100% rejectする。
- 禁止: selector、URL、command、raw input、confirmed vulnerabilityを返すresponseを採用しない。

## Plan

1. Signal type、stable ID、rule registry、dedupeを固定する。
2. Lead schemaとref allowlist validatorを固定する。
3. loopback transport、attestation、timeout、JSONL evidenceを接続する。
4. rule-only fallbackとscout/report CLIを実装する。
5. AC-LX-006〜008をfixtureで受入する。

## Patch

- LLM clientの既存安全境界をscout adapterへ再利用する。
- Signalの一次正本はtrace/oracleから生成し、LLM responseを正本にしない。
- raw prompt/response、secret、PIIをartifactへ保存しない。
- provider unavailable時の暗黙fallbackを追加しない。

## Tests

- 固定trace corpusからSignal IDとdedupeの再現性。
- valid response、extra key、duplicate key、unknown ref、危険フィールドのschema negative。
- timeout、attestation mismatch、loopback外endpoint、token budget超過のfail-closed。
- rule-onlyでSignalとLead候補を生成し、LLM不在でも欠落しないこと。
- scout logのredaction、digest、schema hash、reject reason。

## Commands

- npm run check:docs
- npm run typecheck
- npm run lint
- npm run build
- npm test
- npm run acceptance:fixture

## Notes

LLM provider追加可否とprovider別attestationはDEC-LX-004で決める。LLMは補助器であり、oracle、outcome、Gateの権限を持たない。
