---
document_id: LAKDA-PYTHON-VALIDATION-20260910
status: local-evidence
last_updated: 2026-09-10
---

# Python結果記録・依存lock照合のローカル検証

対象は `b027b6ba9797a2a30b5e98008a1cb848c2c81e05` と本Taskのdirty作業差分。[Task 62](../../tasks/TASK.20260910-62.md)、[SPEC-02](SPEC-02-NATIVE-EVIDENCE.md)、[受入条件AC-UP-002](../../proposals/20260910-detailed-checklist.md)に対応する。これはローカル補助証跡であり、固定SHAの統合受入や実機受入を完了させる記録ではない。

## 実装した契約

- module／classの初期化・後始末errorを独立recordにする。直前caseの結果を上書きせず、実行開始case数と結果record数を区別する。fixtureの未計測時間はnull、JUnitのtimeは省略する。
- expected failureとunexpected successを通常成功から分離する。JSONは元の状態と件数を保持し、JUnitはそれぞれskipped／failureへ対応させる。通常skipはordinarySkipped、JUnitに対応するskippedは通常skipとexpected failureの合計とする。
- 0件・全skip・全expected failureを不合格にし、reasonと非0終了を返す。subtestの後続skipで失敗・errorを取り消さない。
- lockを全件解釈し、interpreterのsite-packagesにあるdistributionのversionを照合する。欠落・不一致・重複・想定外packageは不合格にする。pipだけを未固定installerとして明示除外でき、vendored distributionを導入packageの一覧へ混ぜない。
- import元が照合した環境のsite-packages内か確認する。照合不合格時はimportを行わず理由を保存する。新しいv2証跡はatomicに保存し、既存fileへの上書きを拒否する。旧import-only証跡は履歴として保持する。

## 実行結果

| 検証 | 実結果 | 条件・範囲 |
|---|---|---|
| Python全体 | 48 tests、failure 0、error 0、skip 0、exit 0 | Python 3.12.14／win32。最終集計fieldを含み、2026-09-10T04:28:42Z〜04:28:47Zに実行 |
| npm run check | 359 tests pass、exit 0 | 文書・typecheck・lint・build・全体回帰。ordinarySkippedの追加前の実行であり、その追加後にPython全48件を再実行した |
| npm run pack:check | 469 files、51 schemas、隔離install検証pass、exit 0 | offline npm cacheを使用。CLI・package import・通常／batch／未確定／署名媒体／関連媒体reportを確認 |
| 配布物のPython verifier | 43 package一致、7 imports pass、exit 0 | tgzからverifier・helper・lockだけを取り出し、そのdirectoryをcwdとして既存venvのPythonで実行。repoのPython sourceをimport経路に使わない |
| 依存環境の実測 | 43／43 package一致、追加0、除外0、7 imports pass、exit 0 | Windows／AMD64、Python 3.12.14。既存clean venvの追加読取検証であり、再installではない |

全体checkとpackage checkはNode 24.11.0／npm 11.6.1で実行した。宣言されたrelease runtimeのNode 24.6.0／npm 11.5.1に一致する受入としては扱わない。最後のREADME追記はskip集計の説明で、package実行記録のtarballはその追記前のbytesを保持する。

Pythonの先行試験では、fixture開始前errorによるreporter例外、skipによる失敗消失、expected failure／unexpected successの誤表示を確認した。依存の先行試験では、lock照合APIの欠落、既存証跡の上書き、欠落lockでの結果未保存を確認した。修正後はJSON／JUnit・終了code、正常／異常lock、metadataの境界、import元、保存済みfileの不変性をfixtureで確認している。

実測した[v2依存証跡](../../../tools/airtest-poco-bridge/compatibility/windows-amd64-py312-20260910-lock-verified.json)は[公開schema](../../../schemas/lakda-bridge-dependency-verification-v2.schema.json)へ適合する。schema試験では旧scope・旧version・lock digest欠落・照合不合格／import失敗を全体成功とする記録を拒否した。schema検査だけでインストール済みfile bytesの完全性を証明するものではない。

## 再実行

```powershell
npm run test:bridge:python -- --python <python.exe> --out <new-output-directory>
npx playwright test tests/airtest-poco-bridge-contract.spec.ts tests/schema-catalog.spec.ts --workers=1
<venv-python.exe> -B tools/airtest-poco-bridge/verify_dependencies.py --lock tools/airtest-poco-bridge/locks/windows-amd64-py312.txt --out <new-evidence.json>
```

依存検証は対象host／architecture／Python用のlockを用い、新しい出力先を指定する。compile/import中の第三者packageのSyntaxWarningはログへ保持した。scanner起動・端末接続は行っていない。

## 対象source

| path | bytes | SHA-256 |
|---|---:|---|
| `tests/python/run_tests.py` | 6137 | `41a6a62140603d3b3a0b4af5fc387c3d0228ad25dfedb7a1005b65fe196e76f4` |
| `tests/python/test_evidence_output.py` | 7025 | `638c9dffab1e7176debf367d4e44583d4970fdfb08b0c3d35343251cb103280c` |
| `tests/python/test_dependency_lock.py` | 3643 | `241197fdf952d42ae65e1ee2894cf8742e10adf6763e5bee51656b2c7b103243` |
| `tests/python/test_dependency_verification.py` | 4924 | `b50cc3b215e0efa0cadeef477acb7862a30bf39128d61a01284ad7d456e6eedc` |
| `tools/airtest-poco-bridge/dependency_lock.py` | 3004 | `7ac7b7a1fc09d3e362092bb567200a41eeeed2465493b13e2592961c6a2fb02e` |
| `tools/airtest-poco-bridge/verify_dependencies.py` | 4614 | `d3cdaa905310ba51c07ca5c9faac184cb2c970aecfadc168978b3fac5d63f1b6` |
| `schemas/lakda-bridge-dependency-verification-v2.schema.json` | 4987 | `de62b79f49b5274905e285f2aba12b146675c985e62ec30d5ae25a9db6c04dc5` |

## 保存した証跡

`.lakda/`のpathはこのworkspaceのローカル出力。Gitへ含める受入記録とは区別し、移動・共有するときは保存したbytesと下記digestを一緒に扱う。

| path | bytes | SHA-256 |
|---|---:|---|
| `.lakda/python-lock-reporting-counts.log` | 7762 | `f96d8a19b447ed70da0d0125b5ce5a284d39b064e54040993511b2354c92d317` |
| `.lakda/qa/python-lock-reporting-counts/summary.json` | 9768 | `ece0ddd2f45de342f9140375f7f36c1eb00dd5173d8b4389dd1198c5045778ac` |
| `.lakda/qa/python-lock-reporting-counts/junit.xml` | 5799 | `98be3b762173c6539a43968b2efdd38f726b9ffb269a99e41693b9c768c6a891` |
| `.lakda/python-lock-reporting-check.log` | 62557 | `1e846ae0914c92a9c3c3c8013719a00901607ab907ad917d684d9fad85ea4cbd` |
| `.lakda/python-lock-reporting-pack-check.log` | 4245 | `05522da22f56fea9c2323061247499727b2c45bd78a24989e5cef1af66538c2b` |
| `.lakda/python-packaged-verifier-20260910/result.json` | 816 | `9cf5f7e9171f17604c5a44039b2898749a2a707d68589920cf65d062e4892f54` |
| `tools/airtest-poco-bridge/compatibility/windows-amd64-py312-20260910-lock-verified.json` | 12510 | `c3c12aacdd3d2ce701157c2cbad27f06e0d56ee779e8f4dcc95f6f5fa5ac4f8d` |

配布物の記録は`.lakda/python-packaged-verifier-20260910/`へ保存した。tgz SHA-256は`bf7af15c4441fbf4deefff97ed2b1b54bef72b268fd8c773a596fbcfd5d2a726`。抽出した3 fileのhashと生成証跡のhashは同directoryの`result.json`にある。

## 残る受入

GitHub上のPython 3.13 fixture／3.12.14 dependency job、他hostのmatrix、Windows／Android／iOS実機、requiredChecksへの接続、固定SHAの統合受入は未完了。Task 62はin_progressを維持し、外部署名受渡し・実観測identity・report容量境界・統合受入を含む7件全体の完了を、この記録で代替しない。
