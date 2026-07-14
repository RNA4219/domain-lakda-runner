---
document_id: LAKDA-SPEC-AE-001
status: review-ready
version: 0.1.0-draft
last_updated: 2026-07-14
requirements: ../../../REQUIREMENTS-ADAPTIVE-EXPLORATION.md
checklist: CHECKLIST-01-COMMON-CORE.md
---

# SPEC-01 共通コア・動的candidate・安全制御

## 1. 目的と境界

本仕様は、Lakda Coreとadapterの共通契約、操作ごとの再観測、動的candidate、局所ActionContract、共通Safety Policyを規定する。
対応チェックリストは[CHECKLIST-01](CHECKLIST-01-COMMON-CORE.md)、受入方法は[評価仕様](EVALUATION-ADAPTIVE-EXPLORATION.md)を参照する。

既存の`smoke`、`seeded-random`、`regression-replay`、`llm-explore`は変更しない。動的candidateを使用する実行は新しい`adaptive-explore` modeだけで有効にする。

## 2. 一次所有要件

| 要件群 | 要件ID |
|---|---|
| 共通契約 | REQ-CORE-001, REQ-CORE-002, REQ-CORE-003, REQ-CORE-004, REQ-CORE-005, REQ-CORE-006, REQ-CORE-007 |
| 観測 | REQ-OBS-001, REQ-OBS-002, REQ-OBS-003, REQ-OBS-004, REQ-OBS-005, REQ-OBS-006 |
| candidate・局所契約 | REQ-ACT-001, REQ-ACT-002, REQ-ACT-003, REQ-ACT-004, REQ-ACT-005, REQ-ACT-006, REQ-ACT-007, REQ-ACT-008, REQ-ACT-009, REQ-ACT-010, REQ-ACT-011 |
| adapter共通 | REQ-ADP-001, REQ-ADP-002, REQ-ADP-003, REQ-ADP-004 |
| 安全制御 | REQ-SAFE-001, REQ-SAFE-002, REQ-SAFE-003, REQ-SAFE-004, REQ-SAFE-005 |

## 3. modeと実行ライフサイクル

`adaptive-explore`は次の順序をMUSTとする。

1. config、target scope、adapter capability、Safety Policyを検証する。
2. adapterのcapabilityを固定し、初回`observe`を行う。
3. Observationをredactionし、保存可能性と完全性を判定する。
4. fingerprintを生成し、adapterがcandidateを列挙する。
5. Coreがscope、deny、mutation、budget、guardを評価して実行可能集合を確定する。
6. Generatorが実行可能集合からcandidate IDを1件選ぶ。
7. 実行直前に再観測し、state参照、guard、安全条件を再検証する。
8. adapterが実行し、versioned settle policyを適用する。
9. settle後に再観測してcandidate集合を破棄・再生成する。
10. ExecutionResult、OracleResult、証跡参照を確定し、Stop Conditionを評価する。

candidateが0件の場合は、定義済みbacktrackまたは停止へ進む。古いcandidate集合の再利用は禁止する。

## 4. 共通契約

すべての契約は`schemaVersion`を必須とし、未知versionは`unsupported`で拒否する。adapter固有objectは`adapterDataRef`として保存済みartifactを参照できるが、公開schemaへ直接埋め込まない。

### 4.1 Observation

| field | 型 | 規則 |
|---|---|---|
| `schemaVersion` | string | canonical schema version |
| `observationId` | string | run内一意 |
| `observedAt` | RFC 3339 | fingerprint入力から除外 |
| `targetRef` | TargetRef | context/page/frame/device/surfaceを識別 |
| `completeness` | enum | `complete`, `partial`, `unavailable` |
| `url` | string? | allow scope検査後の正規化値 |
| `personaRef` | string? | secretを含めない論理persona |
| `ui`, `forms`, `dialogs` | object | redaction済み構造 |
| `topology` | object | target親子関係とlifecycle |
| `networkSummary` | object? | body、cookie、authorizationを含めない |
| `obligations` | object | 達成・未達・不明 |
| `provenance` | object | adapter、runtime、capability、revision |

raw secret、cookie、authorization、実form値、実PIIはObservationへ格納しない。`partial`と`unavailable`は成功観測として扱わず、candidate生成可能範囲を明示する。

### 4.2 ActionCandidate

| field | 型 | 規則 |
|---|---|---|
| `candidateId` | string | stable semantic ID |
| `adapterId` | string | capability固定済みadapter |
| `targetRef` | TargetRef | 生成時target |
| `sourceFingerprint` | string | 別stateでの再利用禁止 |
| `actionKind` | enum | adapter capability内の宣言型操作 |
| `locatorRecipe` | object | role/name、label、test ID等 |
| `inputProfileRef` | string? | 自由入力値を持たない |
| `generatedBy` | object | rule、Observation ref、根拠 |
| `risk` | object | risk weight、business priority |
| `mutationKind` | enum | `none`を含む明示分類 |
| `contractRef` | string? | ActionContract参照 |

candidate IDは`adapterId + targetRef + semantic locator + actionKind + inputProfileRef`をversioned canonical化して生成する。element handle、DOM列挙順、object列挙順へ依存してはならない。

### 4.3 ActionContract

`enabledWhen`は実行直前の最新Observationに対するguardである。`ensures`は操作後の期待、`invariants`は前後で維持すべきpersona、認証、host、data境界である。

- guard不成立は`denied/guard_not_satisfied`として記録し、adapterを呼ばない。
- ensures不一致はExecutionResultを上書きせず、product OracleResultを追加する。
- invariant違反は独立OracleResultと安全停止候補にする。
- product契約がないcandidateはgeneric guardだけで実行できるが、product成功は`inconclusive`とする。
- LLMは既存candidate IDを選択できるだけで、selector、URL、path、値、code、commandを追加できない。

### 4.4 ExecutionResult

ExecutionResultは`candidateId`、`preFingerprint`、`postFingerprint`、開始・終了時刻、`status`、`failureSignature`、`recoveryStatus`、`targetChanges`、`settleResult`、`evidenceRefs`を持つ。

statusは`executed`, `denied`, `unsupported`, `timeout`, `target_lost`, `action_failed`, `infrastructure_error`を区別する。guard不成立、Safety拒否、kill switchは`executed`にしない。

### 4.5 OracleResultとEvidenceArtifactRef

OracleResultは`oracleId`、`oracleClass`、`verdict`、`severity`、`sourceRefs`、`requirementRefs`、`evidenceRefs`を持ち、ExecutionResultと別recordにする。

EvidenceArtifactRefは保存済みartifactの検査済みpath、SHA-256、size、classification、redaction status、security status、HATE/v1 entry refを持つ。同じartifact bytesやmanifest entryを複製しない。

## 5. settleと再観測

settle policyは`policyVersion`、action種別、最大待機時間、navigation条件、DOM安定window、page/frame lifecycle、network条件を持つ。network idleだけを完了条件にしてはならない。

次のいずれでもsettleを終了する。

- 全必須条件が安定windowを満たした: `settled`
- policy timeout: `timed_out`
- target消失: `target_lost`
- crash、認証喪失、scope逸脱、kill switch: `aborted`

終了理由にかかわらず可能な範囲でpost Observationを取得する。action成功後に再観測が失敗した場合、そのactionを正常遷移として確定せず、Observation completenessとfailureを保存する。

## 6. candidate生成と選択前検査

候補抽出は表示中、enabled、操作可能、許可action kindの要素に限定する。ただし可視性は安全許可を意味しない。Coreは次の順に検査する。

1. source fingerprintと最新fingerprintの一致
2. targetとhostのscope
3. deny action
4. mutation policyとfixture reset
5. rate、resource、artifact、Action Budget
6. ActionContract guard
7. adapter capability

拒否したcandidateもattempt、理由、state、policy version、証跡を保存する。候補集合は各操作後、target切替後、recovery後、backtrack後に必ず再生成する。

## 7. adapter interface

```ts
interface AdaptiveAdapter {
  capabilities(): AdapterCapabilities;
  observe(target: TargetRef, context: ObserveContext): Promise<Observation>;
  generateCandidates(observation: Observation): Promise<ActionCandidate[]>;
  execute(candidate: ActionCandidate, context: ExecuteContext): Promise<AdapterExecution>;
  recover(failure: AdapterFailure, context: RecoverContext): Promise<RecoveryResult>;
  captureEvidence(request: EvidenceRequest): Promise<EvidenceArtifactRef[]>;
}
```

capabilityはrun開始前に固定する。実行中のbackend切替や別操作基盤への暗黙fallbackは禁止する。固有errorは元error refを保持したまま`unsupported`, `denied`, `timeout`, `target_lost`, `action_failed`, `infrastructure_error`へ対応付ける。

Coreはadapter failure、oracle failure、runner error、artifact failureを統合せず、Outcome Policyへ別入力として渡す。

## 8. Safety Policy

全操作経路は同じversioned Safety Policyを通る。対象はcandidate生成後の実行、InputGenerator、strict replay、recovery、failure shrinking、security mutationである。

必須policyはallow target、allow host、deny action、mutation、fixture reset、Action Budget、artifact budget、duration、maxActions、rateを持つ。

delete、deactivate、billing、transfer、purchase、publish、external message、credential変更は既定denyとする。許可する場合も、明示action ID、対象、環境、期間、fixture reset、予算を必要とする。

kill switchはGenerator、LLM、adapter、recovery、shrinkerより優先する。発火後は新規操作を開始せず、進行中操作の安全な中断と証跡確定だけを行う。

## 9. failureと復旧不能時

| 条件 | 結果 | 継続条件 |
|---|---|---|
| unknown schema/capability | `unsupported` | 該当機能を使わない候補がある場合のみ |
| stale candidate | `denied` | 最新集合から再選択 |
| scope/deny違反 | `denied` | 拒否証跡保存後、別の安全候補のみ |
| settle timeout | `timeout` | SPEC-02の復旧条件をすべて満たす場合のみ |
| target lost | `target_lost` | 明示backtrack成功時のみ |
| kill switch | safety stop | 新規操作禁止、証跡確定後終了 |
| artifact/security failure | runner error | 探索停止、Outcome Policyへ渡す |

## 10. 規範シナリオ

### 10.1 正常

button click後にDOMとpopup topologyが変わる場合、settle後のObservationから新candidate集合を生成し、旧button candidateは再利用しない。

### 10.2 境界

candidateが可視だがdisableへ変化した場合、実行直前guardで拒否し、adapter executeを0回とする。

### 10.3 異常

LLMが未知candidate IDまたはselectorを返した場合、schema/allowlist違反として拒否し、代替selectorを生成しない。

### 10.4 禁止操作

購入buttonが可視でも、mutation許可とfixture resetがなければcandidate実行を拒否し、拒否理由とstateを証跡化する。

## 11. 受入対応

- `AC-AE-001`: 操作後candidate再生成とstale candidate実行0件。
- `AC-AE-014`: 共通adapter境界、暗黙fallback 0件、lossless error対応。
- `AC-AE-016`: authorization、deny、budget、kill switch後のactive操作0件。

具体的なcorpus、試行回数、証跡は[評価仕様](EVALUATION-ADAPTIVE-EXPLORATION.md)で定義する。
