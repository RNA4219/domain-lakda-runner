---
document_id: LAKDA-SPEC-AE-006
status: review-ready
version: 0.1.0-draft
last_updated: 2026-07-14
requirements: ../../../REQUIREMENTS-ADAPTIVE-EXPLORATION.md
checklist: CHECKLIST-06-SECURITY-ADAPTER.md
---

# SPEC-06 認証済み探索型Security adapter

## 1. 目的と位置づけ

本仕様は、明示許可された環境に対する認証済み探索型DASTと継続的セキュリティ探索を、Lakdaの共通状態遷移、安全、replay、証跡モデルへ接続する方法を規定する。
対応チェックリストは[CHECKLIST-06](CHECKLIST-06-SECURITY-ADAPTER.md)、受入方法は[評価仕様](EVALUATION-ADAPTIVE-EXPLORATION.md)を参照する。

Lakdaは完全自動ペンテストを称さず、人間のペンテストを補助する。明示許可のないactive scan、mutation、raceを行わない。

## 2. 一次所有要件

| 要件群 | 要件ID |
|---|---|
| Security adapter | REQ-SECX-001, REQ-SECX-002, REQ-SECX-003, REQ-SECX-004, REQ-SECX-005, REQ-SECX-006, REQ-SECX-007, REQ-SECX-008 |

共通のallow/deny、budget、kill switchは[SPEC-01](SPEC-01-COMMON-CORE.md)を一次仕様とし、security操作にも同じSafety Policyを適用する。

## 3. AuthorizationRecord

active security capabilityを有効にする前に、検証済みauthorization recordを必要とする。

| field | 規則 |
|---|---|
| `authorizationId` | 一意で監査可能な参照 |
| `owner` | 対象責任者または承認主体 |
| `targets` | allow host、path/resource scope、除外対象 |
| `environment` | production/staging/local等 |
| `validFrom`, `validUntil` | 期間外は無効 |
| `allowedMutationKinds` | 許可された操作種別の列挙 |
| `rate`, `concurrency` | hard cap |
| `dataPolicy` | fixture、synthetic data、保存禁止情報 |
| `cleanup` | reset/cleanup契約 |
| `killSwitch`, `stopContact` | 停止方法と連絡先 |
| `approvalEvidenceRef` | redaction済み承認証跡 |

欠落、期限切れ、target/environment/scope不一致、signatureまたはapproval ref不正の場合、active mutationとscan capabilityを無効にする。passive observationは通常のscopeとdata policyを満たす場合だけ許可する。

## 4. environment policy

productionは既定で`passive-only`とする。active scan、parameter mutation、skip、reorder、double execution、rate test、raceはauthorization recordの明示許可がなければcandidate生成も実行もしない。

stagingやlocalも無条件にはactiveにならず、操作種別、rate、cleanup、fixture resetを検証する。環境名だけで許可を推測しない。

## 5. role/persona差分

role差分caseは同一resource identity、同一product revision、同一fixture baseline、persona/session identity、request templateを記録する。

比較手順は次とする。

1. personaごとに認証状態とsession validityをgeneric oracleで確認する。
2. baseline personaでresourceと期待policyを観測する。
3. 比較personaで同一resource/requestを許可範囲内で再現する。
4. responseだけでなくstate、side effect、postconditionを比較する。
5. 認証喪失、session不一致、fixture差分は`inconclusive`として認可候補と分離する。

差分だけでconfirmed vulnerabilityにせず、product/security oracleと人手確認または明示確認手順を必要とする。

## 6. mutation model

各security操作は別`mutationKind`として保存する。

| kind | 内容 | 必須制約 |
|---|---|---|
| `id-parameter` | ID、query、path、body parameter差替え | field allowlist、synthetic/fixture値 |
| `step-skip` | 必須と想定されるstep省略 | prefix state、postcondition |
| `step-reorder` | 許可済みstep順序変更 | 全step ID、reset |
| `double-execution` | 同一操作の二重実行 | idempotency対象、回数上限 |
| `rate` | 回数制限検査 | rate budget、停止閾値 |
| `race` | 許可済み同時実行 | 専用scheduler、concurrency、cleanup |

すべてのmutationは元request template hash、変異field、case ID、pre/post state、request/response evidence refを保存する。secretやraw authorizationをtraceへ含めない。

## 7. race scheduler

raceは通常の逐次workerを並列化して実装しない。専用schedulerがauthorization、target、concurrency budget、開始barrier、timeout、cleanup、kill switchを管理する。

schedulerは各participantを独立stepとして保存し、送信時刻、完了時刻、結果順、side effect、cleanup結果を記録する。budget超過、target逸脱、cleanup不成立、kill switchでは新規participantを開始しない。

production raceはauthorization recordに対象endpoint、最大concurrency、最大attempt、実行時間帯、stop contactが個別記載されている場合だけ許可する。

## 8. ZAP連携

ZAPは外部adapterとして認証、spider、passive/active scan、report機能を利用する。LakdaはZAP scan engineを再実装しない。

capabilityはZAP version、利用可能feature、scan policy、authentication contextをrun開始前に固定する。ZAP不在またはfeature不足を別scannerへのfallbackで隠さない。

ZAP alertは`security-candidate`として取り込み、alert ID、plugin/rule、confidence、risk、request/response ref、discovery state、replay traceを保存する。ZAP alertだけでconfirmedへ昇格しない。

## 9. security oracleと確認flow

verdictは`candidate`、`confirmed`、`rejected`、`inconclusive`を区別する。

confirmedに必要な最小条件は次である。

- authorization scope内のreal実行。
- 再現可能なtraceと同一または同値security signature。
- product contextと期待authorization/policy。
- false-positive要因の除外。
- 人手確認recordまたは承認済み明示security oracle。

LLM、scanner alert、単一response差分だけではconfirmedにしない。分類変更は元candidateを保持した派生resultとして行う。

## 10. 停止・cleanup・証跡

authorization不正、scope逸脱、rate/concurrency超過、認証喪失、critical side effect、cleanup失敗、kill switchでactive探索を停止する。拒否と停止理由はfailureを隠さず保存する。

証跡はauthorization ref、persona、mutation kind、pre/post fingerprint、redaction済みrequest/response、replay trace、OracleResult、cleanup、environment、revisionを持つ。実serverのreal実行だけを確認証跡として扱う。

Lakdaはsecurity candidate/confirmed resultをHATE/v1 manifestへ登録するが、QEG verdict、approval、waiverを生成しない。

## 11. 規範シナリオ

- authorization欠落: active candidate生成0件、拒否理由とpolicy evidenceを保存する。
- production既定: passive observationのみでparameter mutation、reorder、raceを0件とする。
- role差分: session期限切れを認可脆弱性にせずinconclusiveにする。
- race: 専用concurrency budget超過時に新規participantを開始せずcleanupへ移る。
- ZAP: high risk alertでもcandidateとして取り込み、確認手順なしにconfirmedへしない。
- kill switch: 発火後のactive requestを0件にし、進行中結果とcleanupを確定する。

## 12. 受入対応

- `AC-AE-016`: authorization欠落、scope外、production active、deny、budget超過、kill switch後のactive操作0件。candidateとconfirmed vulnerabilityを分離する。
