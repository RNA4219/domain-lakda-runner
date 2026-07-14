---
document_id: LAKDA-SPEC-AE-004
status: review-ready
version: 0.1.0-draft
last_updated: 2026-07-14
requirements: ../../../REQUIREMENTS-ADAPTIVE-EXPLORATION.md
checklist: CHECKLIST-04-PLAYWRIGHT-ADAPTER.md
---

# SPEC-04 Playwright Web/SaaS adapter

## 1. 目的と受入環境

本仕様は、PlaywrightをLakdaのWeb/SaaS向け「目と手」として接続し、DOM、URL、通信、page/frame/dialog/popup topology、candidate、実行、証跡を共通契約へ変換する方法を規定する。
対応チェックリストは[CHECKLIST-04](CHECKLIST-04-PLAYWRIGHT-ADAPTER.md)、受入方法は[評価仕様](EVALUATION-ADAPTIVE-EXPLORATION.md)を参照する。

最初の適応探索adapterは現行Playwright実装を基礎とし、Chromiumで受入する。Firefox/WebKit対応は本仕様の受入対象外である。

## 2. 一次所有要件

| 要件群 | 要件ID |
|---|---|
| Web target | REQ-WEB-001, REQ-WEB-002, REQ-WEB-003, REQ-WEB-004, REQ-WEB-005, REQ-WEB-006, REQ-WEB-007 |
| Playwright | REQ-PW-001, REQ-PW-002, REQ-PW-003 |

## 3. capability

run開始前に次のcapabilityを固定してObservationへ記録する。

- browser/runtime/version、Chromium revision。
- DOM snapshot、accessibility role/name、test ID、label locator。
- context/page/frame lifecycle、popup/new tab、dialog。
- console、pageerror、request/response summary、download。
- screenshot、trace、HAR等の有効なevidence capture。

無効なlistenerや取得不能なcross-origin内容を成功capabilityとして宣言しない。run中に別browser automation backendへ切り替えない。

## 4. target topology

TargetRefは`browserContextId`、`pageId`、任意の`framePath`、target kind、opener/parent refを持つ。Playwright objectやelement handleを保存しない。IDはrun内でstableに割り当てる。

| kind | 観測・lifecycle |
|---|---|
| `page` | URL、title summary、opener、created/active/closed |
| `popup` | opener、trigger candidate、初期/settle後URL、allow判定 |
| `frame` | parent frame、frame path、origin、attached/detached |
| `dom-modal` | DOM内role/dialog構造、open/close state |
| `js-dialog` | Playwright dialog event、type、redacted message、handling |

active targetの切替、close、openerへの復帰をtrace stepとして保存する。暗黙のpage切替は禁止する。

## 5. Observation変換

Playwright adapterは有効な観測だけを共通Observationへ統合する。

### 5.1 DOM/UI

- user-facing role/name、label、test ID、enabled、visible、editable、checked、selected。
- formのfield type、constraint、関連label、submit relation。実valueは保存しない。
- 主要表示要素とDOM modal。
- redaction済みDOM構造digest。script本文、form値、secret/PII属性を保存しない。

### 5.2 URLと通信

URLはallow scope検査後にcanonical化する。request/responseはmethod、origin/path template、status class、resource type、timing summaryを基本とし、authorization、cookie、query secret、bodyをObservationへ含めない。

### 5.3 machine event

console error、pageerror、crash、request failure、HTTP異常、dialog、download、popup lifecycleをeventとして保存する。generic machine ruleはcontext内の全pageへ適用し、active page以外の異常も欠落させない。

listener登録前に生じうる初期event、page close時のflush、run終了時の未確定eventを明示的に扱う。

## 6. candidate生成

候補は最新Observationから生成する。locatorの優先順位は次とする。

1. role + accessible name。
2. configured test ID。
3. associated label。
4. stable placeholderまたは明示product locator。

CSS/XPathはproduct contractに明示された場合だけfallback recipeとして許可する。element handle、DOM index単独、可変class名をreplay契約へ保存しない。

候補にpage/frame TargetRef、semantic locator recipe、action kind、input profile refを付与する。visible、enabled、editable等の最新状態をguardとして実行直前に再検査する。

## 7. modalとJavaScript dialog

DOM modalは通常のDOM target内構造、JavaScript dialogはbrowser eventとして分離する。

未知JS dialogは既定でacceptしない。優先順位はkill switch、deny policy、ActionContract、mutation policy、明示許可済みaccept、dismiss/holdとする。handling resultとtrigger candidateを保存する。

holdでtimeoutへ至る場合もdialog messageをredactionし、pre-state、elapsed、screenshot可否、handling policyを証跡化する。

## 8. iframe

same-origin frameとallow host内frameをTargetRefへ登録し、candidate locatorにframe pathを付与する。frame detach後のcandidateはstaleとして拒否する。

cross-origin frameはorigin scopeとcapabilityを検査する。DOM取得不能部分はObservation completenessを`partial`とし、外側pageの観測成功で隠さない。scope外frame内操作は生成または実行しない。

## 9. popupと新規tab

popup/page event受信時に新pageを登録し、opener、trigger candidate、初期URL、settle後URL、allow host、lifecycleを保存する。

allow scope外ならactive targetにせず、可能な範囲でcloseし、scope拒否edgeを記録する。allow scope内でも自動追従の可否はActionContractまたは探索policyで決める。

close後は明示strategyでopenerまたは既知pageへ戻り、復帰後fingerprintを検証する。

## 10. 実行・settle・error対応

Playwright操作timeout、page/frame detach、browser crash、locator ambiguity、navigation failureを共通errorへlosslessに対応付け、元Playwright errorをredaction済み参照として保持する。

action後settleはnavigation、DOM安定、page/frame lifecycle、network summaryを使用し、SPEC-01の規則で再観測する。downloadやpopup発生だけをaction成功とせず、postconditionとoracleを別評価する。

## 11. replay

strict replayでは同じTargetRef関係、frame path、opener、target switch、dialog handlingを検証する。page ID自体の一致ではなく、記録済み親子関係とsemantic identityの一致を要求する。

frame、modal、popup、new tabの期待topologyが異なる場合、代替pageへ切り替えず`replay-divergence/target_topology`とする。

## 12. 規範シナリオ

- 正常: buttonからallow host popupが開き、新pageを登録して再観測・候補再生成する。
- 境界: same-origin frameが実行直前にdetachした場合、stale candidateとして拒否する。
- 異常: activeでないpageにpageerrorが発生してもgeneric OracleResultへ記録する。
- 禁止: scope外cross-origin frameや未知dialogのacceptを実行しない。
- replay: popupのopenerが異なる場合、見た目が同じでもtopology divergenceにする。

## 13. 受入対応

- `AC-AE-008`: modal、dialog、same/cross-origin frame、popup、新規tabのtarget関係とgeneric rules。
- `AC-AE-010`: modal、frame、popupを含むstrict replay。
- `AC-AE-014`: 共通契約だけでCoreへ接続し、object漏出、暗黙fallback、lossy error変換0件。
