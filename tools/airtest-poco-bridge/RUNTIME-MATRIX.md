# Bridge依存の実測matrix

2026-09-10のローカル検証。下表はhost Python環境とpackage importの確認範囲であり、device操作・撮影の実機受入を含まない。

| host／architecture | Python | Airtest／Poco | lock・clean install／import | 実機受入 |
|---|---|---|---|---|
| Windows／AMD64 | 3.12.14 | 1.3.5／1.0.94 | [hash付きlock](locks/windows-amd64-py312.txt)、新規venvへinstall成功、[v2の照合記録](compatibility/windows-amd64-py312-20260910-lock-verified.json)で43 packageのversion一致・7 moduleのimport成功 | Windows／Android／iOSともpending_external |
| macOS／arm64・x86_64 | 未検証 | 未検証 | pending_external：対象hostとPython実行環境が未提供 | pending_external |
| Linux／x86_64 | 未検証 | 未検証 | pending_external：対象hostとPython実行環境が未提供 | pending_external |
| Windows／arm64、他Python version | 未検証 | 未検証 | pending_external：互換性を本行へ流用しない | pending_external |

Python 3.13のCI fixture jobはstdlibのbridge動作検査であり、この依存matrixとは別。CI jobの定義は追加済みだが、GitHub上の実行結果は未取得。

## 実測と再実行

[import証跡](compatibility/windows-amd64-py312-20260910.json)のlock SHA-256は`148ac21f265703c631f2db1473c3e869fbc1ff00220cc2ceb28c8aee759f1466`。resolverはuv 0.10.10、Python 3.12.14、target `x86_64-pc-windows-msvc`を使用した。

```powershell
uv pip compile tools/airtest-poco-bridge/requirements.txt --python <python312.exe> --python-platform x86_64-pc-windows-msvc --generate-hashes --no-header --no-annotate --output-file tools/airtest-poco-bridge/locks/windows-amd64-py312.txt
uv venv <new-venv> --python <python312.exe>
uv pip sync tools/airtest-poco-bridge/locks/windows-amd64-py312.txt --python <new-venv>/Scripts/python.exe --require-hashes
<new-venv>/Scripts/python.exe -B tools/airtest-poco-bridge/verify_dependencies.py --lock tools/airtest-poco-bridge/locks/windows-amd64-py312.txt --out <evidence.json>
```

採用lockのclean installはexit 0、旧v1のimport検証はexit 0／7 imports pass。旧証跡のpackagesはimport後にPythonが認識するdistribution一覧で、setuptoolsが同梱するdistributionも含む。runtime依存と配布物hashを固定するlockであり、OS、SDK、driver、外部device、隔離build環境の全toolchainや再ビルドbytesの同一性を保証するものではない。

2026-09-10T04:14:50Zの[v2照合](compatibility/windows-amd64-py312-20260910-lock-verified.json)は、同じvenvのsite-packagesから43 distributionを列挙し、lockの全43 packageのversion一致、追加package 0件、installer除外0件、同環境内の7 imports成功を記録した。lock SHAは上記と同じで、終了codeは0。再installの記録ではなく、既存clean install後の環境を読み取った追加検証である。scopeは`locked-versions-and-package-import`、[schema](../../schemas/lakda-bridge-dependency-verification-v2.schema.json)を持つ。旧import-only記録を上書きしていない。

最初のclean installではAirtestの`distutils.version` importが失敗した。Python 3.12のruntime providerとしてsetuptools 84.0.0を入力へ固定し、空のvenvから再検証した。Airtest／pywinauto等の配布sourceに既存SyntaxWarningが出たが、7 importsは完了した。動作互換は実機受入で別途確認する。

Windowsのlockを別OS・architecture・Python minorへ流用しない。未検証環境ではそのhostでhash付きresolver出力、空venvのinstall／import結果、実機受入を追加する。Lakda本体からinstall、upgrade、bridge起動は行わない。
