---
status: local_complete
owner: RNA4219
last_reviewed_at: 2026-11-25
next_review_due: 2026-12-25
---

# 画面・API の実行カバレッジ

ユーザー承認範囲: 要件・仕様の記載、実装、テスト、修正、PR、保護規則と必須チェックを満たすマージ。本番配備と認証・権限設定変更は対象外。

変更対象: `src/surface-coverage/`、CLI dispatcher/parser/help/runtime、core runner、`scripts/local-console/`、platform replay と console、テスト、例、仕様・README。既存作業は専用 worktree により分離する。共有認証実装は変更しない。

正本: [仕様と要件](../spec/e2e-platform/SPEC-10-RUNTIME-SURFACE-COVERAGE.md)、[受入条件](../spec/e2e-platform/CHECKLIST-10-RUNTIME-SURFACE-COVERAGE.md)。

CI 修正範囲: `tests/python/test_native_identity_capture_exchange.py` の identity/idempotency fixture に有効な時計を固定し、artifact 配列を参照する前に accepted と件数を検証する。時刻失効・逆行の専用テストと本体の認証 guard は変更しない。

結果: [受入記録](../acceptance/AC-20261125-runtime-surface-coverage.md)。[PR #25](https://github.com/RNA4219/domain-lakda-runner/pull/25) の通常チェック完了後にマージする。

## 実利用フィードバック（2026-11-25）

9674374に対して5項目の報告を受けた。識別子保存と製品版bindingの修正に加え、準備完了条件、hash/DOM状態、既存Playwright用SDKの追加を利用者が明示承認した。仕様・AC-S14〜19・SDK導入例を更新し、`tests/surface-field-feedback.spec.ts`で直接検証する。通常テストとは別のlocalhost機能受入と最終SHAの記録は[専用の受入入口](../acceptance/AC-20261125-surface-field-feedback.md)から参照する。
