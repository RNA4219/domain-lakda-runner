---
document_id: LAKDA-SPEC-AE-002
status: review-ready
version: 0.1.0-draft
last_updated: 2026-07-22
requirements: ../../../REQUIREMENTS-ADAPTIVE-EXPLORATION.md
checklist: CHECKLIST-02-STATE-GRAPH-EXPLORATION.md
---

# SPEC-02 状態fingerprint・遷移グラフ・適応探索

## 1. 目的

本仕様は、Observationからの状態識別、観測後付けの状態遷移グラフ、GeneratorとStop Condition、discovered-model coverage、循環抑制、backtrack、timeout復旧を規定する。
対応チェックリストは[CHECKLIST-02](CHECKLIST-02-STATE-GRAPH-EXPLORATION.md)、受入方法は[評価仕様](EVALUATION-ADAPTIVE-EXPLORATION.md)を参照する。

## 2. 一次所有要件

| 要件群 | 要件ID |
|---|---|
| fingerprint | REQ-FP-001, REQ-FP-002, REQ-FP-003, REQ-FP-004, REQ-FP-005, REQ-FP-006 |
| graph | REQ-GRAPH-001, REQ-GRAPH-002, REQ-GRAPH-003, REQ-GRAPH-004, REQ-GRAPH-005, REQ-GRAPH-006, REQ-GRAPH-007 |
| Generator | REQ-EXP-001, REQ-EXP-002, REQ-EXP-003, REQ-EXP-004, REQ-EXP-005, REQ-EXP-006, REQ-EXP-007 |
| Stop Condition | REQ-STOP-001, REQ-STOP-002, REQ-STOP-003, REQ-STOP-004, REQ-STOP-005, REQ-STOP-006 |
| coverage | REQ-COV-001, REQ-COV-002, REQ-COV-003, REQ-COV-004, REQ-COV-005, REQ-COV-006, REQ-COV-007, REQ-COV-008 |
| 循環・復旧 | REQ-REC-001, REQ-REC-002, REQ-REC-003, REQ-REC-004, REQ-REC-005, REQ-REC-006, REQ-REC-007 |

## 3. StateFingerprint

StateFingerprintは`algorithmVersion`、`canonicalizationVersion`、`value`を持つ。hash入力はUTF-8のstable-key JSONとし、同じcanonical Observationからbyte-identicalな入力を生成する。

### 3.1 canonical成分

- 正規化URL: scheme、allow host、port、pathname、意味のあるqueryだけを含む。
- redaction済みDOM/UI構造: role、name、state、主要locator、form構造。
- persona、obligation、modal/dialog状態。
- browser context、page、frame、popupまたはdevice/surface topology。
- status classへ正規化した主要通信状態。

timestamp、nonce、random ID、animation値、token、cookie、実入力値、実PII、順序が意味を持たないobjectの列挙順は除外する。除外規則はcanonicalization versionに含める。

fingerprintとは別に`observationDigest`と`componentSummary`をgraph nodeへ保存し、衝突と過剰分裂を診断可能にする。類似状態clusterはexact nodeを置換せず、別の派生indexとして扱う。

## 4. 状態遷移グラフ

各runはversioned graphを持つ。graphはaction traceから再構築可能でなければならない。

### 4.1 node

| field | 規則 |
|---|---|
| `nodeId` | exact fingerprint value |
| `fingerprintVersion` | algorithm/canonicalization version |
| `observationDigest` | redaction済みObservationのdigest |
| `componentSummary` | URL、persona、topology、主要UIの要約 |
| `firstSeen`, `lastSeen` | 証跡時刻。node同一性には使わない |
| `visitCount` | 再観測を含む訪問回数 |
| `knownCandidateIds` | そのrevisionで観測したcandidate集合 |
| `obligations` | 達成、未達、不明 |
| `evidenceRefs` | Observation等の検査済みartifact |

### 4.2 edge

| field | 規則 |
|---|---|
| `fromNodeId` | pre fingerprint |
| `candidateId` | backtrack/recoveryの場合も明示ID |
| `toNodeId` | post fingerprint。取得不能時はnullと理由 |
| `edgeKind` | action、denied、timeout、recovery、reset、backtrack |
| `attemptCount` | 同一from/actionの試行数 |
| `outcomeCounts` | status別の件数 |
| `latencySummary` | count/min/max/合計または決定的集約 |
| `oracleRefs` | edgeに関連する判定 |
| `failureSignatures` | 元failureを保持 |
| `evidenceRefs` | trace、screenshot等 |

同じ`fromNodeId + candidateId`から複数toが観測された場合は全edge outcomeを保持し、non-deterministicとして印を付ける。後勝ち上書きは禁止する。

保存graphはtraceをreducerへ入力して再構築し、node、edge、count、signature、revisionを比較する。差分はartifact corruptionまたはschema incompatibilityとして扱う。

## 5. Generator

Generatorは実行可能candidate集合、graph snapshot、obligation、top-level seedを入力とし、candidate IDまたは`no-selection`を返す。Stop Conditionやoracle verdictを変更する権限を持たない。

### 5.1 strategy

| strategy | 選択規則 |
|---|---|
| `random` | stable sort後にseeded RNGで一様選択 |
| `weighted-random` | versioned weightとseeded RNGで選択 |
| `least-visited-transition` | `(state,candidate)`の最小attemptを優先 |
| `shortest-to-uncovered` | 既知graph上で未実行candidateへの最短到達prefixを選ぶ |
| `risk-weighted-uncovered` | 未実行、risk、business priority、mutation costをversioned式で評価 |
| `llm-select` | 提示済みcandidate IDからのみ選択する独立Generator |

最初の受入対象は`random`、`weighted-random`、`least-visited-transition`とする。後二者はcapabilityとして明示し、未実装時に別strategyへ暗黙fallbackしない。

### 5.2 `llm-select` strict selection

`llm-select`はLocal LLMへSafety Policy適用済みcandidateのIDとredaction済みgraph summaryだけを提示し、strict JSONの`select`または`stop`だけを受理する。selector、URL、input、path、code、command、Safety Policy変更、oracle verdict、QEG verdictをpromptまたはresponseへ含めない。追加key、duplicate key、提示外candidate ID、未知versionは応答全体をrejectする。

LLMが不在、timeout、model/schema不一致、意味的不合格の場合は`random`その他のGeneratorへ暗黙fallbackしない。runを`partial`、termination reasonを`llm_error`として停止し、attestation ref、input/output digest、reject reasonをredaction済み証跡へ保存する。LLMの明示的`stop`は正常なGenerator停止として記録するが、run pass/failやoracle resultを上書きしない。

### 5.2 決定性

candidateはstable IDでsortし、tie-breakとrandom選択はrunの単一seeded RNGだけを使う。wall clock、network完了順、object列挙順を乱数入力にしない。同じconfig、seed、Observation列、candidate列では選択列をbyte-identicalにする。

## 6. Stop Condition

設定はGeneratorから独立させる。

```json
{
  "generator": { "strategy": "least-visited-transition" },
  "stopWhen": {
    "any": [
      { "type": "transitionCoverage", "atLeast": 0.9 },
      { "type": "obligationCoverage", "atLeast": 1.0 },
      { "type": "noveltyPlateau", "windowActions": 20, "minActions": 30 },
      { "type": "durationMs", "atMost": 600000 }
    ]
  }
}
```

`any`と`all`は明示的に再帰合成する。空配列、未知condition、NaN、負値、整数でないaction数はconfig errorとする。

duration、maxActions、Action Budget、kill switchはhard capであり、論理式の外側で常時適用する。critical failure、認証喪失、scope逸脱、artifact/security failure、必須obligation未達はcoverageより優先して安全停止する。

### 6.1 novelty plateau

window内で新規state、known candidate、transition、obligation達成のいずれも増えない場合にだけ成立する。`minActions`前は成立させない。window、観測項目、last novelty action、graph revision、終了理由を保存する。

## 7. coverage

coverageは未知状態を含むシステム全体の絶対網羅率ではなく、指定graph revisionのdiscovered-modelまたは固定obligationに対する指標である。

| metric | 分子 | 分母 |
|---|---|---|
| discovered/new state | 観測node数・期間内新規数 | 分母なし |
| novel state rate | window内新規state | window action数 |
| executed action coverage | 実行済み`(state,candidate)` | 既知`(state,candidate)` |
| transition coverage | 実行済みedge | graph revisionの既知edge |
| transition-pair coverage | 実行済み連続edge pair | 既知の連続可能pair |
| obligation coverage | 達成obligation | run開始時に固定したobligation集合 |

すべてのratioは分子、分母、graph revision、計測時刻を保存する。新candidate発見で分母が増えcoverageが低下することを正しい挙動として時系列に残す。

探索効率は再訪率、loop率、failure edge率、non-deterministic edge率を別指標にする。round-trip coverageはcycle長と列挙上限をconfigで固定できる場合だけCOULD capabilityとして追加する。

## 8. 循環抑制とbacktrack

循環はstate visit budget、edge revisit budget、loop penalty、plateauで抑制し、絶対禁止しない。認証更新や非決定的確認のための必要再訪を許容する。

backtrack strategyは次を宣言型IDで扱う。

- `browser-back`
- `close-target`
- `fixture-reset-and-prefix-replay`

backtrackは通常actionと別edgeKindにし、前後fingerprintと期待nodeを保存する。期待nodeへ戻れない場合は`backtrack-divergence`を記録し、探索を継続しない。

## 9. timeoutと復旧

timeout時はpre-state、candidate、target、elapsed、screenshot/trace可否、network summary、post-timeout Observation、failure signatureを先に確定する。

継続できるのは次をすべて満たす場合だけである。

1. targetを再観測できる。
2. targetとURLがallow scope内である。
3. persona、認証、invariantが維持される。
4. crash、critical oracle、artifact/security failureがない。
5. 明示recovery strategyが成功する。

同一stateのtimeout candidateを即時再試行せずquarantineし、revisit budgetへ加算する。recovery成功は元timeout、oracle failure、run failureを上書きしない。

## 10. 規範シナリオ

- 正常: 未実行transitionをleast-visitedで優先し、新edge追加後にcoverage分母と時系列を更新する。
- 境界: plateau window直前で新candidateが増えた場合、windowをそのactionから再計測する。
- 異常: 同じstate/actionから2つのto stateを観測した場合、両方を保持しnon-deterministicとする。
- 復旧: timeout後にpersonaが変化した場合、別candidateへ進まずdivergenceと安全停止を記録する。
- hard cap: coverage 100%と同じactionでkill switchが発火した場合、kill switchを終了理由にする。

## 11. 受入対応

- `AC-AE-002`: fingerprint再現性、material差分、secret/PII残存0件。
- `AC-AE-003`: traceからgraph再構築一致。
- `AC-AE-004`: 100 runの選択列byte-identical。
- `AC-AE-005`: Stop Conditionとhard cap。
- `AC-AE-006`: open-world coverageと分母増加。
- `AC-AE-007`: 有限停止、timeout証跡、安全復旧、元failure保持。
