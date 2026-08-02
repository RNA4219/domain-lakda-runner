---
document_id: LAKDA-SPEC-AX-INDEX
intent_id: INT-LAKDA-AUTONOMOUS-EXPLORATION-001
owner: RNA4219
status: implementation-complete-real-acceptance-pending
version: 0.3.0
last_updated: 2026-08-03
---

# 自動・クロスプラットフォーム探索的テスト仕様

このディレクトリは、既存の適応型探索6仕様を組み合わせ、PC Web、mobile Web、Windows、Android、iOSを自動探索する統合MVPを定義する。基礎型・adapter・oracleの一次所有は[適応型探索仕様](../adaptive-exploration/README.md)に残し、本仕様はsession、platform matrix、visual candidate、finding、capture、統合Gateを所有する。

- [SPEC-01 自動・クロスプラットフォーム探索的テスト](SPEC-01-AUTONOMOUS-CROSS-PLATFORM-EXPLORATION.md)
- [CHECKLIST-01 自動・クロスプラットフォーム探索的テスト](CHECKLIST-01-AUTONOMOUS-CROSS-PLATFORM-EXPLORATION.md)

仕様完成、fixture実装、実機受入は分離する。`lakda explore run/resume/report/acceptance`、PlaywrightのPC／mobile lane、Airtest/Poco loopback reference bridge、capture／finding／session-HATE契約はfixtureと契約テストの範囲で実装済みである。Web real revision probeとWindows、Android実機、iOS実機の署名済みreal evidenceが揃うまで統合MVPは`pending_external`であり、fixture成功を実機受入へ昇格しない。bridgeはLakdaが起動せず、運用者がloopbackで起動する。

統合acceptance indexの`entries.executionMode`は全laneで`real`に限定する。eligibleになる条件は、PC Web、mobile Web、Windows、Android、iOSの5 laneすべてについて、承認済みtarget（Webはrevision probeを含む）のreal report、署名、SHA-256、session HATEが検証済みであることとする。real preflight後は署名済みtarget manifest bytesをsession canonical `target-manifest.json`へ固定し、charter／config／capability／target revision／adapter／bridge bindingを再照合する。session-started eventのhash-chain、capability snapshotの実bytes/digest、1件以上のrun IDとrun HATE参照、session HATE包含、HATE security statusも再検証する。fixture／emulator／mock reportは契約テストには利用できるが、acceptance indexへ登録せず、real Gateへ昇格しない。単一real reportに残る`real-lane-acceptance-required`は自己参照sentinelとして五lane集約時だけ解決され、その他のreport blocker、`technicalOutcome`非passed、capture failureはentryをrejectedにする。

ローカルfixtureの入口は次のとおり。

```powershell
lakda explore run --charter examples/exploration-charter.playwright.json
lakda explore report --session .lakda/explorations/<session-id> --out .lakda/reports/exploration.json
lakda explore pause --session .lakda/explorations/<session-id>
lakda explore kill --session .lakda/explorations/<session-id>
lakda explore bookmark --session .lakda/explorations/<session-id>
lakda explore fork --session .lakda/explorations/<session-id>
lakda explore acceptance --index <exploration-acceptance-index-v1.json> --trust-store <operator-trust-store.json>
```

resumeは保存済みのcharter、config、capability、event hash chain、checkpoint、trace/replay-trace digest、post-fingerprint、rate budgetを再検証してから実行する。real laneは署名済み`lakda/exploration-target-manifest/v1`とtrust storeを接続前に検証し、native binaryはtarget manifestで許可されたattestorの`lakda/binary-artifact-attestation/v1`が検証済みの場合だけHATEへ登録する。Web revision probeまたはnative bridge報告revision・app／device digestが一致しない場合はexit 2で操作0件とする。ただしreference bridgeのnative identityはoperator宣言であり、実機APIの独立観測ではないため、実機取得記録とmanual-bbをreal evidenceとして別途必要とする。session HATE（`exports/artifact-manifest.json`）はCharter、capability、events、checkpoint、findings、report、参照run manifestの実bytesを登録する。実機laneのfixture結果はreal acceptanceへ昇格せず、reportへ`real-lane-acceptance-required`を残す。五laneの署名・SHA-256・HATE検証は`lakda explore acceptance`で集約し、個別reportの`real-acceptance.json`検査は行わない。pause／kill／bookmarkはatomic control queueで受理し、resumeは暗黙forkせず、分岐は明示的な`fork`で作成する。
