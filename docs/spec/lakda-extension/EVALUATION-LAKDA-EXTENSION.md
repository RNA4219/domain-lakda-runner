# Lakda拡張 評価仕様

## 評価指標

| 指標 | 分子 | 分母 | revision |
|---|---|---|---|
| interaction coverage | 実行済みvalid tuple | valid tuple総数 | coverage schema revision |
| lead usefulness | reproduced Lead | generated Lead | KPI revision |
| lead replayability | strict replay一致Lead | investigate対象Lead | KPI revision |
| safety refusal | Safety拒否操作 | 生成操作 | safety policy revision |
| artifact completeness | digest/HATE refが揃うartifact | 追加artifact総数 | HATE/v1 revision |

## 判定

P8〜P10はlocal fixtureで決定性、coverage、fail-closed、replay divergence、promotion、redactionを検証する。P11はapproved real targetでのみAC-LX-014を評価し、未設定時はpending_externalを維持する。LakdaはGo/No-Go、manual-bb、QEG verdictを生成しない。

## 終了条件

- schema追加キー、未知version、未知refがrejectされる
- combo suiteがbyte-identicalでvalid coverageを満たす
- Signal/Leadがsource refとdigestを持つ
- strict replayが一回でdivergenceを検出する
- reproduced以外のpromotionが拒否される
- artifact redaction/scan/digest/HATEが通る
- P11 report/verifierがQEG handoffをpending_externalに固定する

対応チェックリスト: [Checklist-01](CHECKLIST-01-COMBINATION.md)、[Checklist-02](CHECKLIST-02-SCOUTING.md)、[Checklist-03](CHECKLIST-03-INVESTIGATION-EVIDENCE.md)。
