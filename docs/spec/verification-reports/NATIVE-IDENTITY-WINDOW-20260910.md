---
document_id: LAKDA-NATIVE-IDENTITY-WINDOW-20260910
status: local-evidence
last_updated: 2026-09-10
---

# 承認期限の伝播とUTC時計のローカル検証

[Task 68](../../tasks/TASK.20260910-68.md)、[SPEC-02](SPEC-02-NATIVE-EVIDENCE.md) 0.1.15、セルフレビューSR-66〜71の記録。[native操作](NATIVE-IDENTITY-ACTIONS-20260910.md)へ承認期間の制約と署名済みwrapperを追加した。HEADは `b027b6ba9797a2a30b5e98008a1cb848c2c81e05`、既存dirty差分込み。実機・固定SHA受入ではない。

## 実装した処理

native-action v2は、検証したtarget文書の実bytesのSHA-256、承認開始・終了時刻を要求と応答へ保持する。bridgeはleaseの初回要求でversionと承認期間を固定し、途中のtarget変更・期間変更・v1との混用を拒否する。観測が60秒有効でも承認が5秒なら、5秒の境界で操作を拒否する。準備中の失効はSDK開始前に止め、SDK開始後ならactionAttempted=trueの失敗として扱う。

Node内部のcreateNativeIdentityExecutorは、最初のawait前にtarget bytes・Charter・config digest・trust keysを固定する。署名を観測前に検証し、観測取得の直前から単調時計を保持する。操作と復旧の前後で署名・identity・承認期限を検査し、同時要求を拒否する。失敗後は停止し、自動retryしない。応答を検証できない通信失敗では操作開始の有無をunknownとし、検証済みreceiptが得られた後の失効ではそのreceiptとactionAttemptedを保持する。この値は当該呼出しのSDK開始に関する情報であり、物理的効果や取消し成功を証明しない。

低水準APIのapprovalWindowは追加制約であり、bridge自身がoperator署名を検証する機能ではない。wrapperの署名検証と組み合わせる。既存candidateの安全検査、CLI preflight、session保存・reader照合を置き換えない。

## 実行中に見つかった問題

Windowsで過大な本文を送信しながらserverが本文読取前に接続を閉じる試験にWinError 10053が出た。Content-Length=65537のheaderだけを送る試験へ変更し、本文を待たず413を返すことを検証した。serverの容量上限は緩めていない。

独自bridgeの過大な応答がwrapperのreceipt検査を通る先行試験も失敗した。共通receipt verifierへ64 KiB制限を加え、HTTP clientとwrapperの双方でschema・時刻・window・連番・resultを照合する。

最初のPython HTTP → Node試験は実行準備で拒否された。メモリ上だけで診断を追加したmoduleにより、観測時刻が要求時刻より3ms古い例を確認した。導入済みPython 3.12.14のtime.get_clock_infoはGetSystemTimeAsFileTime、resolution=0.015625を返した。native protocolはWindowsのGetSystemTimePreciseAsFileTimeを使うよう修正し、FILETIMEとISO時刻を整数でミリ秒へ変換する。API不能を粗い時計で代替しない。これは[Pythonの変更記録](https://docs.python.org/3.13/library/time.html#time.time)および[Windows API仕様](https://learn.microsoft.com/en-us/windows/win32/api/sysinfoapi/nf-sysinfoapi-getsystemtimepreciseasfiletime)と整合する。

その後、SDK応答のcheckedAtがNodeの時計より1ms先である例を計測した。Nodeは2ms以下の差に限り、元のAbortSignalで一度2ms待ち、同じ厳格な条件を再検査する。timestampを補正せず、待機とevent loop遅延を既存予算へ含める。未来時刻や要求前時刻を許容する比較へ変更していない。診断用のメモリ上のmodule変更を除いた最終sourceで10回連続の相互運用を確認した。

## 最終検証

Windows、Python 3.12.14、Node 24.11.0／npm 11.6.1。宣言runtimeはNode 24.6.0／npm 11.5.1で、packのEBADENGINE警告を保持する。実端末・実operator承認鍵は使用していない。時計の取得だけは導入環境のWindows APIも呼び、端末操作は人工SDKで検証した。

| 検証 | 結果 | 範囲 |
|---|---|---|
| Python関連 | 68 passed | 既存native試験、承認期間9件、clock 4件、追加HTTP 2件を含む |
| Python全体 | 116 tests、exit 0、failure／error／skip 0 | JSONとJUnitの116件、window 9件・clock 4件の所属を照合 |
| Node関連 | 44 passed | window、署名wrapper、既存target・exchange、schema catalog |
| 最終 npm run check | 511 passed、exit 0 | docs・型・Lint・build・全回帰 |
| offline npm run pack:check | 549 files／61 schemas、exit 0 | clock helper、executor、v2 schemaを必須化。隔離install・CLI・import・report確認 |
| 最終sourceのHTTP相互運用 | 10 trials、全件passed | 各回5 query・人工SDK操作2回・共有API操作0。fixture Ed25519署名、観測、v2操作／復旧、window対応 |

最終Python全体はUTC `2026-09-10T13:59:00.1984094Z`〜`2026-09-10T13:59:06.4602868Z`。全体checkは `2026-09-10T13:58:59.8875095Z`〜`2026-09-10T14:02:05.0537248Z`。その前の全体510件からclock修正と待機試験を追加しており、最終sourceで511件を再実行した。最終packは `2026-09-10T14:02:33.4402901Z`〜`2026-09-10T14:02:57.3021098Z`。最終check開始後にruntime・schema・testは変更していない。本記録・索引等の追記後はdocs／diff／digestを別途照合する。

正常なwindow対応に加え、期限境界、未来の承認開始、不正・非正規時刻、期間／target変更、version変更、準備中失効、SDK開始後失効、単調時計の再起算防止、wall clock逆行を試験した。Nodeでは不正署名・trust・Charterによる観測前拒否、identity差による操作前拒否、初期入力・操作入力のsnapshot、同時要求拒否、失敗後停止、検証不能な応答のunknown、取得済みreceiptの保持を確認した。

## 残る作業

実transportの接続世代、CLIの初回／resumeへの接続、観測と操作応答のsession保存およびHATE／report読取、Windows／iOS provider、実機3laneの受入は未完了である。同じSDK object／selectorでの再接続を識別できるとは主張しない。CLIと既定readerのtarget v2拒否を維持し、Task 68はin_progress、AC-UP-008／022は未完了とする。他の改修案・レポート・固定SHA受入の範囲も継続する。

## SHA-256

以下は本検証時点のsnapshot。履歴の検証記録を現在のsource digestへ更新しない。logと人工出力はrepo内の非公開作業directoryへ保存した。

| repo相対path | SHA-256 |
|---|---|
| `tools/airtest-poco-bridge/native_identity_actions.py` | `sha256:58dcd95cee830a2422e43fe31dd6a1ce80e91665a600a8d9cee862ce9e7b5c84` |
| `tools/airtest-poco-bridge/native_identity_exchange.py` | `sha256:5d243fbf17c2c595ccae46c2c45d7655369ca148bce43fd76beb8019c356b78e` |
| `tools/airtest-poco-bridge/native_identity_clock.py` | `sha256:025b111228a15c2a55f8ded48edc26cd93aed9be93821ef61c3e47ebe597b2d5` |
| `src/exploration/native-identity-actions.ts` | `sha256:7b69ac31f0f9326e20780ccd03e0e40da393f8337ac90ab80039938bc73597e4` |
| `src/exploration/native-identity-exchange.ts` | `sha256:24f507776b518eab9373f668bb44341c46d14f6f73cebd0137197ffb9ce9ae17` |
| `src/exploration/native-identity-executor.ts` | `sha256:1ee78e656d1f56d6a60637447e883600ccfc95736787af1b72ffbae75fdb9448` |
| `schemas/lakda-native-action-v2.schema.json` | `sha256:ff3babea130a01d3df640e5009091358d917819ad1ea608d065911e6b5594028` |
| `tests/python/test_native_identity_actions.py` | `sha256:fdbd7e6f4c59790d67d2e2bda1f4723d12ecaebbb397d675ea97afc586350d63` |
| `tests/python/test_native_identity_actions_http.py` | `sha256:b5d216d27dbe6adae4f295438b4129821b80241d70d1e516ecc31bcb163154c0` |
| `tests/python/test_native_identity_window.py` | `sha256:cb10a4f0f836754613c76a1d6fdbdc7bd601d94e7ad9459852954f7354641822` |
| `tests/python/test_native_identity_clock.py` | `sha256:820f7f7732d3b08c9f8aaca07403957541671cc5b3e65aa9a1a0234221f5f010` |
| `tests/native-identity-actions.spec.ts` | `sha256:9386a41c48ab4662bc732d8f291dcddd39020f41164c8dc237aed0ef00991fdb` |
| `tests/native-identity-target.spec.ts` | `sha256:b1025cb969deb49d9eebd4c53d351f83d2c10b47076e516aa6a97968eb1eded3` |
| `scripts/check-package-contents.mjs` | `sha256:f0093ae43cf00c6fbbd2d888a885bd53e0a0d55b9c20ab8b721d7f01329d0792` |
| `scripts/check-package-install.mjs` | `sha256:71501c2e87d8e02737e54cef312dde396796454540556d02fe0188ced755fd35` |
| `docs/spec/verification-reports/SPEC-02-NATIVE-EVIDENCE.md` | `sha256:cd83f1de0ae271e499f797313faa51b6678f211b8472e5b4ed9f92868f5ba677` |
| `tools/airtest-poco-bridge/README.md` | `sha256:27f5e056308ea3af76f374b0d8f26a648b937b0b695d0af2c35ceb8a2e681e43` |
| `.lakda/native-identity-window-final-check.log` | `sha256:6fec0511bf456c46227340c3f4f5661b50b4d4a14d359447120215af6ac1e41a` |
| `.lakda/native-identity-window-final-python.log` | `sha256:08fa0853a314aa301aaeba5a9dcb90ee68daa67423d5060b8f344e7cd2bc5b9e` |
| `.lakda/native-identity-window-final-python-tests/summary.json` | `sha256:3ec7f8fec91c362e17444c1b13c1854fb2f20e7b2b80febae3d7be15b3d28318` |
| `.lakda/native-identity-window-final-python-tests/junit.xml` | `sha256:fa24bd8a02983575431327048ee444b28edbd502f122b27743c5ce53b51a9dfc` |
| `.lakda/native-identity-window-precise-interop.json` | `sha256:b976c176c8d0b6211b71bb1d67dca380e3096ad0c0d02ae354b8afb0ab25bbef` |
| `.lakda/native-identity-clock-client-related.log` | `sha256:d8ff11c732a5b48f36d7199cfaaea91a2157a6ead3b4270d03db18d17573d393` |
| `.lakda/native-identity-window-pack.log` | `sha256:fc06b2618bf646d8bcb89dc5d907139ce3b006b0c33a5c81db17b8bf5b9ae4bc` |
| `.lakda/native-identity-clock-environment.json` | `sha256:8a25bd5c0bde701ccd766faa20f5e16390071207ab360bb79fa03e2947b9f73b` |
| `.lakda/native-identity-window-clock-probe.log` | `sha256:aed529bd1bea237828293526cd3546037bab07886ee3d7b1ccbed34e4b138655` |
| `.lakda/native-identity-window-action-clock.log` | `sha256:642c677cd247cb02e1f0d12b23c0ed4c7fddde20f044c47d92d09b6967bcebf1` |
| `.lakda/native-identity-window-http-interop.stderr.log` | `sha256:8261bd6260dab0247f449cf5bde0abbd4b8c3bff8a97821aa8abd1575410c3ea` |
