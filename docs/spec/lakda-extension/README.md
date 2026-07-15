---
document_id: LAKDA-SPEC-EXT-001
status: implementation-baseline
version: 1.0.0
last_updated: 2026-07-15
requirements: ../Lakda拡張要件定義書.md
---

# Lakda拡張仕様書

## 1. 目的と非破壊境界

P8〜P11の追加経路を、既存のObservation、ActionCandidate、ExecutionResult、OracleResult、EvidenceArtifactRef、RunResultへ接続する。既存mode、action-plan/v1、adaptive-trace/v1、HATE/v1、QEG境界は変更しない。

各仕様には対応チェックリストを紐付ける。

- [Checklist-01 Combination](CHECKLIST-01-COMBINATION.md)
- [Checklist-02 Scouting](CHECKLIST-02-SCOUTING.md)
- [Checklist-03 Investigation/Evidence](CHECKLIST-03-INVESTIGATION-EVIDENCE.md)

## 2. Combination契約（P8）

factor modelは schemaVersion、modelId、generatorPolicy、factors、constraintsを必須とする。factorは input/state/action/environment のいずれかで、値は安全なfixture値だけを保持する。constraintは allOf、anyOf、not、eq、neq、in、notIn、implies の専用DSLとし、未知factor/refは生成前に拒否する。

generatorは model digest、generator version、seed、strength、factorGroup、case budgetを入力に、stable sortしたgreedy IPOG相当のsuiteを生成する。同一入力はbyte-identicalである。指定groupの3-way tuple以外はpairwiseのままにする。

verifyは入力modelからvalid assignmentとtupleを独立再計算し、model digest、constraint、unknown ref、duplicate case、coverage不足を返す。invalid時はexit 1で、部分suiteを成功扱いにしない。

Playwright forms観測はvisible/enabledのselect optionを値IDとして安定ソートし、disabled、hidden、空値、secret/PII patternを除外する。

## 3. Signal/Lead/Scout契約（P9）

trace entryからtimeout、trace failure、oracle failure、topology change、coverage gap、safety refusalをrule-firstでSignal化する。Signal IDはrun、kind、source refs、fingerprint、観測属性のcanonical digestで決まり、重複を除去する。

LeadはSignal refのみを束ねる調査候補で、priorityとstatus=openを持つ。rule-only groupingはkind、target、fingerprintでグループ化し、lead cap既定3を超えない。

LLM scoutはloopback LocalLlmClientのattestation/timeout/token契約を継承する。contextはLead IDとcapability refのみ、responseはstrict JSON・追加キーなし・提示済みLead refのみとする。selector、URL、path、code、command、raw input、confirmed verdictは拒否し、providerを暗黙切替しない。判断はredacted digest JSONLへ記録する。

## 4. Investigation/Promotion/Shrinking契約（P10）

investigateはreviewer refとLead digestを記録し、strict replayを一回だけ実行する。pre/post fingerprint、settle、topology、oracleが一致しない場合はreplay_divergedでfail-closedにする。

promoteはstatus=reproducedかつartifact/oracle refが存在する場合だけ受理し、parent investigation digest、kind(trace|suite)、派生artifact refsをimmutableに記録する。元Lead/run/artifactは変更しない。

shrinkingはsafe non-mutating sequenceだけをcase→sequence→inputの順で試行し、scope allowlist、mutation allowlist、attempt budget、kill switchを各候補へ適用する。KPIはrevision、numerator、denominator、ratioを持つ。

追加artifactはArtifact Storeのredaction→secret/PII scan→size/SHA-256→HATE/v1 exportを通す。失敗は成功へ変換しない。

## 5. P11 real acceptance

runnerは承認済み環境変数、immutable corpus、case ID、target revision、config digestをtarget接続前に検証する。不足または不整合の場合は非0終了でpending_externalを出し、targetへ接続しない。

成功時のcase reportはexecutionMode=real、OracleResult refs、HATE artifact refs、manifest path、qegHandoff.status=pending_external、verdictGeneratedByLakda=falseを必須とする。verifierは最終HATE manifestの実bytes/digestとreport refsを再照合する。manual-bb/QEGのverdictは生成しない。

## 6. CLI契約

- combo gen: factor modelからsuite.jsonを生成
- combo verify: suiteのcoverage/constraint reportを生成
- scout: configとtrace/suiteからSignal/Lead reportを生成
- investigate: Leadをstrict replayしてinvestigation recordを生成
- promote: reproduced investigationのみtrace/suiteへ昇格
- report leads: JSON/HTMLでLead一覧を出力

未知version/ref、追加キー、禁止mode、scope外、budget超過は非0終了とする。
