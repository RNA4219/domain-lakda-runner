---
document_id: LAKDA-SPEC-UP-003
status: implementation-ready
version: 0.1.0
last_updated: 2026-09-10
requirements: ../../proposals/20260910-detailed-requirements.md
checklist: CHECKLIST-03-GOVERNANCE.md
---

# SPEC-03 保守構造・履歴・受入記録

対応[checklist](CHECKLIST-03-GOVERNANCE.md)。REQ-UP-MOD、LEG、EVDとCOMを担当する。

## Objective

reportから再利用可能なstrict readerを整備し、旧workflowと現行releaseを分離し、最終sourceへ検証を結び付ける。

## Catalog boundary

`src/runs/catalog.ts`は公開facadeを維持する。入力read／path／digestの検証、graph／coverage parse、summary、comparatorを責務別moduleへ分割する。移動だけの変更と意味変更を分ける。

streaming readerはHATE manifestのschema、unique path、実path、size／SHA、run ID／attempt／commitを検証する。media Bufferを全保持しない。読取対象textには個別／合計上限を掛け、budget超過はerror。reportの上限を既存catalogの公開制限へ暗黙に適用しない。

## Document checker boundary

checkerをMarkdown共通、v1契約、adaptive、extension、maintainability、release profile、Birdseye、新UP仕様追跡へ分離する。各moduleはrootとread interfaceを受け、diagnostic配列を返す。入口で全結果を集め、既存exit／見出しを維持する。

新UP検査は要件定義の一意性、Must→AC、SPEC→checklistの1対1、Task→対象仕様、相対linkを検査する。全文を文字列で複製せず、独立fixtureで欠落・重複・不整合を検証する。

## Legacy P6

旧workflowの内容を `docs/release-gate/history/release-p6-rc.yml.txt` へ保存し、元revision・役割・廃止理由を同directoryの説明へ記録する。コピー前後bytesを照合してから `.github/workflows` から除外する。historyだけをGitから辿れる状態にする。

current profileとrelease-evidence.ymlの導線を維持し、旧workflowのarchiveを現行Gate成功の代用にしない。

履歴には退避時のsubject SHA、元fileの最終変更commitとGit blob、保存bytesのsize／SHA-256を記録する。`.gitattributes`で保存fileの改行変換を止める。文書checkerは旧pathへのworkflow再導入、他のlive workflowへ残るP6固有の納品契約・版検査、履歴fileの欠落・digest不一致を拒否する。期待digestは退避前の実bytesから固定し、通常の文書更新で再計算しない。

## Evidence

作業中はsubject base SHA＋dirty差分の補助検証recordを作る。最終受入は変更をfreezeしたcommit SHAへ全必要Gateを結び付ける。過去recordを移動・再生成しない。Task 59／60の過去件数と新結果を区別する。

新Python／report検証commandは追加後にpackageとcurrent requiredChecksへ接続する。allowlistとworkflow実行mapを同時更新し、未知check拒否を保つ。

## Plan

Task 63で分割、Task 66で履歴化と暫定記録、Task 69で統合Gate。catalog回帰が通るまでreport固有の意味変更を混ぜない。

## Patch

対象はcatalog、checker、tests、workflow履歴、索引、Task／Acceptance。auth実装・既存署名payload・操作基盤は対象外。

## Tests

AC-UP-006〜010、022。分割前後のcanonical JSON、unknown schema、tamper、list上限、exitを比較する。書換え0件をinput hashで確認する。

## Commands

`npm run check:docs`、`npm run test:contracts`、`npm run release:validate-profile`、`npm run check`、`npm run pack:check`。各変更の関連testを先に実行する。

## Notes

fixture完了はreal／manual-bb／QEG完了と別。外部の署名・承認・判断を生成しない。
