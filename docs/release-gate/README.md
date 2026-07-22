---
document_id: LAKDA-RELEASE-GATE-INDEX-001
status: historical-index
last_updated: 2026-07-22
---

# Historical release Gate design index

このdirectoryの既存JSONと`qeg-600a037/`はv0.3.0-rc.5系の保存済み設計・証跡であり、現行releaseへ流用、再生成、上書きしない。

- `feature_spec.json` — RC5 feature設計
- `risk_register.json` — RC5 risk register
- `manual_case_set.json` — RC5 manual-bb case set
- `rand/` — RC5 RanD入力
- `qeg-600a037/` — revision 600a037に固定されたQEG artifact

現行live releaseは[current release profile](../../release-profiles/current.json)と、そのprofileが参照する`release-profiles/<version>/`配下の設計入力を使う。過去QEG goは記録されたrevision以外へ適用しない。
