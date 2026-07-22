---
document_id: LAKDA-PLAN-MNT-001
intent_id: INT-LAKDA-MNT-001
status: local_complete
owner: RNA4219
last_updated: 2026-07-22
requirements: ../REQUIREMENTS-MAINTAINABILITY.md
---

# Lakda 0.4.0-rc.2 保守性・拡張性実装計画

## Plan

| Phase | Task Seed | 目的 | Gate |
|---|---|---|---|
| 0 | [TASK.20260722-43](tasks/TASK.20260722-43.md) | 保守要件、5仕様、5正本checklist、aliasを確定する | 文書1対1、孤立ID 0件 |
| 0 | [TASK.20260722-44](tasks/TASK.20260722-44.md) | docs索引、HUB、Birdseye、checkerを同期する | `npm run check:docs` |
| 1 | [TASK.20260722-45](tasks/TASK.20260722-45.md) | release profileとlive workflowを汎用化する | profile/package一致、過去RC固定0件 |
| 2 | [TASK.20260722-46](tasks/TASK.20260722-46.md) | real acceptance共通coreを実装する | preflight/digest/HATE共通test |
| 2 | [TASK.20260722-47](tasks/TASK.20260722-47.md) | P7を共通coreへ移行する | exit 0/1/2、legacy report互換 |
| 2 | [TASK.20260722-48](tasks/TASK.20260722-48.md) | P11 v2とtarget candidate auditを実装する | manifest/audit/tamper/v1読取 |
| 3 | [TASK.20260722-49](tasks/TASK.20260722-49.md) | Adapter・Oracle built-in registryを実装する | unknown ID/capability拒否 |
| 3 | [TASK.20260722-50](tasks/TASK.20260722-50.md) | Generator・strict llm-select・P9 degradeを実装する | strict JSON、no fallback、determinism |
| 4 | [TASK.20260722-51](tasks/TASK.20260722-51.md) | Playwright Adapterを責務分割する | facade/安全挙動characterisation |
| 4 | [TASK.20260722-52](tasks/TASK.20260722-52.md) | Coordinatorを責務分割する | action sequence/termination回帰 |
| 4 | [TASK.20260722-53](tasks/TASK.20260722-53.md) | Combinationを責務分割する | suite bytes/seed determinism |
| 4 | [TASK.20260722-54](tasks/TASK.20260722-54.md) | CLIを責務分割する | help/command/exit code回帰 |
| 5 | [TASK.20260722-55](tasks/TASK.20260722-55.md) | runs list/showをread-onlyで追加する | 順序、上限、sanitized schema |
| 5 | [TASK.20260722-56](tasks/TASK.20260722-56.md) | graph compareとtamper/PII境界を実装する | bytes/hash/version/traversal |
| 5 | [TASK.20260722-57](tasks/TASK.20260722-57.md) | sanitized examplesとpackage検証を追加する | schema/secret/PII/package |
| 6 | [TASK.20260722-58](tasks/TASK.20260722-58.md) | 統合Gate、manual-bb、Birdseye、Acceptanceを確定する | local実装完了、Gate実績をAcceptanceへ記録、外部はpending_external |

依存順は43→44→45→46→47→48→49→50→51→52→53→54→55→56→57→58とする。各PhaseのGateが失敗した場合、次Phaseへ進まない。

## 実績

- Phase 0〜6のlocal実装は完了した。取得済みlocal Gate、P7/P11のexit 2、最終subject SHAで未取得のlint再実行を区別し、対象revision、command、終了codeは[AC-20260722-20](acceptance/AC-20260722-20.lakda-040-rc2-local-release-validation.md)へ記録する。
- P7/P11 real target、Airtest/Poco実機、認可済みSecurity target、実Qwen、外部manual-bb、QEGは未実施であり、release状態は`pending_external`を維持する。

## 監査Backlog

| 優先度 | 監査対象 | 完了条件 |
|---|---|---|
| P0 | [TASK 46](tasks/TASK.20260722-46.md)〜[TASK 50](tasks/TASK.20260722-50.md)のacceptance/registry/strict LLM hardeningと[TASK 58](tasks/TASK.20260722-58.md)の統合Gate | 対象testが同一revisionで成功し、統合Gate記録へcommand、終了code、artifact digestを保存 |
| P1 | release profile mutation negative、Legacy P6 workflowの固定revision pinまたはarchive判断 | stale/unknown/missing/path traversal profileを拒否し、Legacy P6の維持根拠またはarchive決定を記録 |
| P2 | runs catalogとcheck-docsの追加責務分割 | catalog reader/comparator、Markdown/schema/profile/Birdseye checkerを独立test可能な単位へ分割 |
| 外部 | P7、P11、Airtest/Poco実機、認可済みSecurity target、実Qwen、manual-bb外部実行、QEG | revision-bound実証跡取得まで`pending_external`。fixture/mockを本証跡へ昇格しない |

## Patch

- Phase 0: [REQUIREMENTS-MAINTAINABILITY](../REQUIREMENTS-MAINTAINABILITY.md)と[仕様索引](spec/maintainability/README.md)を正本化し、P8〜P11短縮checklistを非規範aliasへ変更する。
- Phase 1: `schemas/release-profile-v1.schema.json`と`release-profiles/current.json`を追加し、live workflowのscope、artifact名、acceptance ID、設計入力、required checkをprofileから解決する。
- Phase 2: `src/acceptance`へpreflight/digest/HATE検証を集約し、P11新規出力だけv2へ移行する。
- Phase 3: built-in registryだけを許可し、LLMは安全なcandidate ID選択またはstopに限定する。
- Phase 4: 既存公開fileをfacadeとして残し、分割だけのcommitへ契約変更を混在させない。
- Phase 5: read-only runs list/show/compareとsanitized examplesをadditiveに追加する。
- Phase 6: local fixture/mockとreal external evidenceを明確に分離して記録する。

## Tests

- 文書正本、仕様/checklist 1対1、alias、索引、全schema、release profile。
- P7/P11 preflight、exit 0/1/2、candidate audit、HATE tamper、legacy v1。
- registry unknown ID/capability、LLM strict JSON、提示外candidate、timeout/no fallback、seed determinism。
- 既存5 mode、CLI help、trace/replay、combination suite、package exportの回帰。
- runs順序・比較・version/tamper/traversal、example schema・secret/PII・package。
- manual-bbは主要CLIの正常、境界、異常、禁止系を対象revisionへ結び付ける。

## Commands

- `npm run check:docs`
- `npm run release:validate-profile`
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `npm test`
- `npm run acceptance:fixture`
- `npm run acceptance:adaptive`
- `npm run check:hate`
- `npm run pack:check`
- `npm run test:contracts`
- `npm run test:examples`
- `git diff --check`

## Notes

- 既存`smoke`、`seeded-random`、`regression-replay`、HATE/v1、QEG責務境界を変更しない。
- 歴史的RC5/QEG/Acceptance artifactは移動、再生成、書換えをしない。
- 実target、実機、Security target、manual-bb外部確認、QEGが揃うまでreleaseは`pending_external`である。
- Task Seed 43〜58はlocal実装完了として`done`へ更新した。外部実証跡の未達はTask完了と分離し、releaseの`pending_external`として管理する。
