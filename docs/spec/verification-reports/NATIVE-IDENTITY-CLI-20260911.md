---
document_id: LAKDA-NATIVE-CLI-20260911
status: local_verified
last_updated: 2026-09-11
specification: SPEC-02-NATIVE-EVIDENCE.md
---

# native CLI初回・再開・保存レポートの接続検証

[仕様02](SPEC-02-NATIVE-EVIDENCE.md)、[Checklist 02](CHECKLIST-02-NATIVE-EVIDENCE.md)、[Task 68](../../tasks/TASK.20260910-68.md)。7改修・57要件（Must 55／Should 2）・22受入条件を維持する。今回の変更は連続撮影offのnative v2をCLI初回・draft・paused resumeへ接続する。

## 変更

CLIは署名済みtargetを保存し、sessionのtarget digest、保存bytes、Charter／config、operator trustとnative inventoryをbridge接続前に照合する。その後capability bindingを照合し、必須sink付きbridgeから新しい実観測を保存して探索へ渡す。従来execute／recoverへは送らない。旧capabilityの申告fieldと独立した実観測記録を保持する。

draftは観測未取得を許容し、操作前に初回の観測を保存する。pausedはcompleteな過去journalを接続前に要求する。再開では別journalへ新しい観測を保存してからreplay prefixとcheckpointを照合する。記録改変・欠落・応答不明・承認切れ・端末違いは追加SDK操作0件になる。

相対trust pathは元target manifestの親から解決し、実行・媒体検証・受渡しpreflight・session JSON report・HATEへ渡す。保存JSON reportは観測時点の署名を確認し、現在の承認期限が切れても正当な過去記録を生成できる。HTML reportは引き続きreport設定の明示trustを使う。

native操作応答にpostFingerprintがない場合、最後の操作に続くpost-action観測からcheckpointを作る。過去操作のfingerprintだけで最後の観測欠落を補完しない。trace／replay-traceのdigest照合は維持する。セルフレビューSR-90〜93へ根拠と修正を記録した。

## 検証

対象HEADは `b027b6ba9797a2a30b5e98008a1cb848c2c81e05`、dirty差分込み。Windows、Node 24.11.0／npm 11.6.1、package 0.5.0-rc.1。宣言runtimeのNode 24.6.0／npm 11.5.1による固定SHAの正式受入ではない。

| 検証 | 結果 | ログ |
|---|---|---|
| 初回の先行試験 | 接続前の旧v2拒否で1 failed | `.lakda/native-cli-initial-red-20260911.log` |
| 操作後checkpoint | 操作成功後にpostFingerprint不足で1 failed。最後のpost-action観測を使う修正後は初回成功 | `.lakda/native-cli-initial-connected-20260911.log` |
| pause時の媒体trust | 署名付きfixture画像がある場合も相対trustの解決差でaborted、1 failed。解決基準を統一 | `.lakda/native-cli-resume-media-red-20260911.log` |
| 保存JSON reportとdraft fixture | reportのtrust解決とfixtureの不正状態遷移で2 failed。後者はfixtureをdraft→running→pausedに修正し、本体の遷移制約を維持 | `.lakda/native-cli-report-draft-red-20260911.log` |
| 受渡しpreflightのtrust | 存在する鍵がtrust-invalidになる1 failedを検出して修正 | `.lakda/native-cli-attestation-preflight-red-20260911.log` |
| 最終CLI結合 | 5 passed。初回、期限後の保存JSON report、受渡しsetup、9種の初回拒否、pause→resume、draft、pausedの記録なし／応答不明を含む | `.lakda/native-cli-attestation-preflight-green-20260911.log` |
| native＋既存探索 | 108 passed、exit 0。受渡しpreflightの最後の小修正前の記録 | `.lakda/native-cli-related-final-20260911.log` |
| 最終npm run check | docs・型・Lint・build・全544件 passed、exit 0。受渡しpreflightの修正と追加試験を含む | `.lakda/native-cli-check-final-20260911.log` |
| offline npm run pack:check | 573 files／62 schemas、隔離install、nativeRuntimeImportと既存CLI／report検査がpass、exit 0 | `.lakda/native-cli-pack-20260911.log` |

pause→resume試験は実際のCLI control queueを使う。初回操作1件、再開時のprefix再生1件と追加操作1件、合計3件の人工SDK要求と、2 journal／8記録を検証した。sessionの累積actionCountは既存replay offsetに従って2。改変済みjournalは接続0件、再開後の端末不一致は追加SDK要求0件で拒否した。最後の操作の観測を除去し、前の操作にfingerprintがあってもcheckpointを確定しないことを確認した。

最後の全体検証後に実行source・test・配布checkerを変更していない。pack後は索引・Task・この検証記録を更新する。要件入口とレポート詳細のIDを重複排除して57件、詳細checklistのAC IDを22件と再照合した。

## 範囲と残作業

LoopbackJsonBridge.connectを人工bridgeへ置き換え、一時生成したEd25519鍵・人工観測・fixture画像でCLIとrunLakdaを実行した。CharterのexecutionMode=realはv2経路を検証するための入力であり、実機実行を示さない。今回、実HTTP bridge・実SDK・実ADB・実端末・scanner・外部targetへ接続していない。画像はテスト用v1署名であり、外部scannerの検査実証ではない。新しい受渡しsetupの試験は媒体0件で、実媒体のrequest／response受渡し全体を実証しない。

Python sourceの変更とPython試験の再実行はない。以前の138件は過去記録の証拠で、今回の544件へ合算しない。新しいHTMLの画面QAも今回の追加対象ではなく、既存reportの回帰試験と配布検査を実行した。

videoまたはsampled framesが有効なnative v2は引き続き接続前に拒否する。設定を自動でoffにせず、連続撮影の要件も維持する。SDKと撮影の同一接続確認、Windows／iOS provider、実機3lane、媒体I/Oの残項目、固定SHAの受入・manual-bb・外部QEGは残る。汎用target loaderのv2既定拒否も維持する。CLI接続のfixture成功をTask 68、AC-UP-008／022、7改修全体の完了としない。

[前段のrunner記録](NATIVE-IDENTITY-RUNNER-20260911.md)はSHA-256 `4d25116356629715ea839ec414fcad31bf5bff5096477b1633e798458a7ea58f`のまま保持した。過去記録のsource hashを現在値へ更新しない。

## 対象ファイルのSHA-256

作成時の実bytes 20件を固定する。以後の変更は新しい検証記録へ残す。

| 対象 | SHA-256 |
|---|---|
| `src/commands/exploration.ts` | `4e72594d43154d97e829383f2b7325bda299c05b80cd1bd8d1a38cad059007eb` |
| `src/exploration/session.ts` | `82b561895de614c46d2bd5fbe35cd047103993e088dc30f22e4b13fdc14bc582` |
| `src/exploration/native-identity-runtime.ts` | `1bbe4764a689ee85d23bc0a6e9fcdc08bba7588f4ac3d4baa56bd65dcd09ae5f` |
| `src/exploration/native-identity-evidence-target.ts` | `3c64eac7d98d5e223b99039a48ff6bceabbb7d9a531466a4ef853dfb75ffcc80` |
| `tests/native-identity-target.spec.ts` | `589443b35aeb2941c7cceefac05369ecf69e5e2a999242e45ea7a06a424d5214` |
| `scripts/check-package-contents.mjs` | `a6ac5f103a5b8bdffe2b27a5b9f52ce8bdcf9f7b4b9096fd03b987930a63d3eb` |
| `scripts/check-package-install.mjs` | `dab85da3611e1b0465a1412bb60763ba6095cf66a169434cb4b80f2a79d7c238` |
| `docs/spec/verification-reports/SPEC-02-NATIVE-EVIDENCE.md` | `e2b1903fda787eafef5ae309fb3e27b1d3b34224e7e04422facb70125fb4890f` |
| `docs/spec/verification-reports/SELF-REVIEW-20260910.md` | `365f46e6111ee301403b5483658279b2f1dced4b8f81af19caedd3866591260f` |
| `README.md` | `2825105caf3b079ce4ae9231ddfc4b53c4347ca236611a98dda575f9626ddef7` |
| `RUNBOOK.md` | `db7bb4a807942add7611d6a3204de2f5e5140ecbfaa5ed8d162fabe69c1cf8a6` |
| `.lakda/native-cli-initial-red-20260911.log` | `212755dd5789844352b4226945a7cd51e03c142ff5326ffc12db2c7796f538b2` |
| `.lakda/native-cli-initial-connected-20260911.log` | `ba76d254a765c08534559444e15f95d7ec20304f8563d67927df794007ae6e18` |
| `.lakda/native-cli-resume-media-red-20260911.log` | `1aab6a774c8fbd119e0a494e9684b7adc69fcbbbe94e737372ebccf195c12676` |
| `.lakda/native-cli-report-draft-red-20260911.log` | `56563753256efe562845e6564d5afbd58398a790ade24569ade9dc0cb4cc3796` |
| `.lakda/native-cli-attestation-preflight-red-20260911.log` | `e8ab068f6e4a3c64ff31c014bc1b128ecfb32758f52ffe2bba325493042a7b1f` |
| `.lakda/native-cli-attestation-preflight-green-20260911.log` | `d8ad901ecf0a3cc329a6d82dd183f70b9363eaba626f6c600f6369db1c0b99bd` |
| `.lakda/native-cli-related-final-20260911.log` | `6c8b3d8723202ff52cc2d14eca6c8d91dc6207215a5319bb37a5c70bf33d6f05` |
| `.lakda/native-cli-check-final-20260911.log` | `5931b2b2a9acead03daddc65a7f873ed2eff728f434c752da486a5a4c322716d` |
| `.lakda/native-cli-pack-20260911.log` | `df5c90c431d56c62d2c99f22f3993165bae4744d6f651b5060e93a2211ddec9d` |
