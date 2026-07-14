---
document_id: LAKDA-SPEC-AE-003
status: review-ready
version: 0.1.0-draft
last_updated: 2026-07-14
requirements: ../../../REQUIREMENTS-ADAPTIVE-EXPLORATION.md
checklist: CHECKLIST-03-REPLAY-ORACLE-EVIDENCE.md
---

# SPEC-03 入力生成・strict replay・oracle・証跡

## 1. 目的

本仕様は、form入力case生成、動的探索trace、strict replay、replay divergence、failure shrinking、oracle分離、証跡資格とHATE/QEG境界を規定する。
対応チェックリストは[CHECKLIST-03](CHECKLIST-03-REPLAY-ORACLE-EVIDENCE.md)、受入方法は[評価仕様](EVALUATION-ADAPTIVE-EXPLORATION.md)を参照する。

## 2. 一次所有要件

| 要件群 | 要件ID |
|---|---|
| 入力生成 | REQ-INP-001, REQ-INP-002, REQ-INP-003, REQ-INP-004, REQ-INP-005, REQ-INP-006 |
| strict replay | REQ-REP-001, REQ-REP-002, REQ-REP-003, REQ-REP-004, REQ-REP-005, REQ-REP-006 |
| failure shrinking | REQ-SHR-001, REQ-SHR-002, REQ-SHR-003, REQ-SHR-004, REQ-SHR-005 |
| oracle | REQ-ORC-001, REQ-ORC-002, REQ-ORC-003, REQ-ORC-004, REQ-ORC-005, REQ-ORC-006, REQ-ORC-007 |
| 証跡 | REQ-EVD-001, REQ-EVD-002, REQ-EVD-003, REQ-EVD-004, REQ-EVD-005, REQ-EVD-006, REQ-EVD-007, REQ-EVD-008 |

## 3. InputGenerator

InputGeneratorはLLM自由文ではなく、versioned generator、top-level seed、field domain、input profileから`InputCase`を決定的に生成する。

| field | 規則 |
|---|---|
| `caseId` | generator version、seed、domain ref、case kindからstable生成 |
| `generatorVersion` | 未知versionは拒否 |
| `seed` | runのtop-level seedから派生位置を記録 |
| `domainRef` | HTML constraint、OpenAPI、product schema、fixtureの参照 |
| `caseKind` | valid-equivalence、boundary、just-outside、empty/null、format-invalid、length-invalid |
| `classification` | valid、invalid、unknown |
| `valueRef` | secretを含まない生成値または検査済みartifact参照 |
| `expectedOracleRef` | 明示期待がある場合だけ設定 |

### 3.1 domainと値

- string: 最小長、最大長、直内、直外、empty、format正常/異常。
- number/date: min、max、直内、直外、代表同値class、不正表現。
- enum/radio/select: 有効各class、未選択、許可される場合だけ未知値。
- compound form: pairwiseを既定とし、全組合せは明示budget内だけで生成する。
- file/upload: 既定deny。synthetic fixture、size/type境界、保存先許可がある場合だけ候補化する。

実PII、credential、決済情報を生成しない。synthetic fixtureであることをmetadataへ記録する。HTML/OpenAPI等から導出したdomainもSafety Policyより優先しない。

submit、upload、決済、送信、作成等はmutationであり、明示許可、fixture reset、Action Budgetがない場合は入力だけを生成しても実行しない。

## 4. dynamic trace schema

動的探索traceは現行`lakda/action-plan/v1`を拡張せず、新しい`lakda/adaptive-trace/v1`として保存する。

### 4.1 trace envelope

| field | 規則 |
|---|---|
| `schemaVersion` | `lakda/adaptive-trace/v1` |
| `runId`, `attempt`, `revision` | 実行identity |
| `seed`, `configDigest` | replay入力 |
| `adapter`, `capabilities` | run開始時の固定値 |
| `executionMode`, `environment` | real/simulated/mockと対象 |
| `initialTargetRef`, `initialFingerprint` | replay開始契約 |
| `steps` | 順序を保持する完全操作列 |
| `artifactRefs` | graph、oracle、evidenceへの参照 |

### 4.2 step

各stepはcandidate descriptor、target ref、InputCase、pre/post fingerprint、settle result、ExecutionResult、OracleResult参照、topology差分、backtrack/recovery情報を持つ。

modal、frame、popup、generated input、backtrack、recoveryを通常stepと同じ順序列に保存し、target eventを省略しない。

## 5. strict replay

strict replayはtraceを新たに探索するのではなく、記録済み操作と状態契約を再検証するmodeである。metadataにもこの定義を保存する。

各stepで次を順に検証する。

1. schema、config digest、adapter capability、initial target。
2. pre-fingerprintとtarget topology。
3. candidate descriptorを最新candidate集合で同一IDとして解決。
4. guard、Safety Policy、InputCase。
5. 実行、settle、post-fingerprint。
6. topology、期待OracleResult、failure signature。

pre-state不一致、candidate欠落、guard不成立時に別candidateへ置換しない。期待と実値が異なる場合は`replay-divergence`を保存して停止する。

### 5.1 ReplayDivergence

`stepIndex`、`kind`、期待値、実値、pre/post Observation ref、target topology、oracle refs、evidence refsを持つ。kindは`pre_state`、`candidate`、`guard`、`target_topology`、`post_state`、`oracle`、`failure_signature`を区別する。

## 6. failure shrinking

failure shrinkerはstrict replayの受入後に有効化するSHOULD capabilityである。元traceと元証跡はimmutableに保持し、縮約結果を派生artifactとして保存する。

縮約順序は次とする。

1. cycleとして証明できるsegmentの除去。
2. prefix/suffixを含むsegment elimination。
3. 各candidate traceのguard、persona、scope、fixture reset、target topologyを検証。
4. strict replayで同一または明示同値failure signatureを確認。
5. 局所最小になったtraceと全attempt結果を保存。

派生artifactはparent trace hash、algorithm/version、attempt、採否理由、最終signatureを持つ。destructive action、実決済、外部送信、active security actionを含む場合、専用許可なしにshrinkerを実行しない。

## 7. oracle registry

generic、product、securityは別registry、別OracleResultとして実行する。同一観測へ複数resultを付与でき、相互に上書きしない。

| class | 判定可能範囲 | 禁止 |
|---|---|---|
| generic | pageerror、crash、console error、HTTP異常、timeout、認証喪失、artifact/security failure | product期待結果の推測 |
| product | requirement、obligation、guard、postcondition、invariant | 未定義期待の推測 |
| security | candidate、confirmed、rejected、inconclusive | scanner/LLM単独でconfirmed |

product契約へ未接続の異常は`exploratory finding`にする。defect evidenceへ昇格するには再現trace、期待結果、実結果、oracle ref、requirement ref、対象revision、環境を必要とする。

LLMはoracle候補、要約、重複候補を提案できるが、failure、defect、脆弱性、run outcome、Gate verdictを確定しない。

## 8. 証跡資格とclassification

全runとartifactは`executionMode`、target environment、adapter、device/browser/runtime、revisionを記録する。

| executionMode | 資格 |
|---|---|
| `real` | 実serverまたは実機で観測したproduct behaviorの本証跡 |
| `simulated` | simulator/emulator等の補助証跡 |
| `mock` | mock、fixture、状態注入による契約・integration補助証跡 |

classificationは`exploratory-finding`、`defect-evidence`、`security-candidate`、`confirmed-vulnerability`を分離する。classification変更は新しいOracleResultと根拠を追加し、元recordを上書きしない。

追加artifactは現行Artifact Store、Artifact Policy、Outcome Policy、HATE Exporterの確定順序、redaction、実bytes scan、hash契約を継承する。対象はtransition graph、coverage report、adaptive trace、shrink report、oracle resultsである。

Lakdaの出力境界は検証済みHATE/v1 artifact manifestまでとする。QEG quality-evidence-record、Go/Conditional Go/No-Go/Disqualified、approval、waiverは生成しない。最終判定はHATE adapterを介したQEGだけが行う。

## 9. timeout証跡との連携

SPEC-02でtimeoutが発生した場合もtrace stepを欠落させない。pre-state、candidate、elapsed、target、post-timeout Observation、通信summary、failure signature、recovery attemptを保存する。recovery成功は元timeout resultを変更しない。

## 10. 規範シナリオ

- 正常: seedから同じboundary InputCaseを生成し、popupを含むtraceを3回strict replayする。
- 境界: max length直外値がmutation deny対象なら、case生成は記録してsubmitは拒否する。
- 異常: pre-fingerprintを改変したtraceは最初の不一致stepでdivergenceになり代替candidateを選ばない。
- 縮約: A-B-C-D-failureからBとCを除去できても、同一signatureを再現しない候補は採用しない。
- oracle: HTTP 500はgeneric result、明示postcondition違反はproduct resultとして別々に保存する。
- 証跡: mock runだけではreal必須ACを完了扱いにしない。

## 11. 受入対応

- `AC-AE-009`: 入力classの決定的生成、実PII/credentialと未許可mutation 0件。
- `AC-AE-010`: 20 sequence×3回、成功率85%以上、divergence検出100%。
- `AC-AE-011`: 元trace不変、同一signature、短縮、未許可mutation 0件。
- `AC-AE-012`: oracle/classification分離と誤昇格0件。
- `AC-AE-013`: executionMode資格、HATE/v1検証、LakdaによるQEG verdict 0件。
