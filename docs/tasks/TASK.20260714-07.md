---
task_id: TASK.20260714-07
status: in_progress
owner: RNA4219
created_at: 2026-07-14
updated_at: 2026-07-14
---

# Task Seed: v0.2.1 証跡・Release Gate是正

## 目的

実LLM受入の規範90-runとworker実機20-runを分離し、第三者がchild run/HATE/model attestationを再検証できる証跡契約を作る。release candidateではCode-to-gate → HATE → manual-bb → QEGを接続し、Lakdaのrun outcomeとQEGのrelease verdictを分離する。

## 変更境界

- Lakda production: provider model照合、実runtime/model attestation。
- Lakda evidence: v2 report、sanitized bundle、verifier、V8 coverage変換、HATE/RC入力prepare。
- Lakda CI: 通常PRはfake LLM、RCはself-hosted Windows/Qwenの手動workflow。
- Code-to-gate: secret markerとCSS `content`の誤検知回帰を独立PRで修正。
- workflow-cookbook: acceptance自動発見、`.lakda`除外、未変更capsule timestamp維持を独立PRで修正。
- 禁止: raw browser artifact、auth state、raw prompt、生bundleのGit commit。LakdaによるQEG verdict/record生成。

## 実装順

1. `full` 90-run、`worker-smoke` 20-run、`custom`不適格を固定する。
2. `lakda/real-llm-acceptance/v2`とsanitized bundle/verifierを実装する。
3. GGUF/model/runtime/chat-template attestationをfail-fast化する。
4. Code-to-gate strict、HATE二段検証、manual-bb real staging、QEGをRC workflowで接続する。
5. 要件・仕様・評価・Runbook・受入訂正・Birdseyeを更新する。
6. runtime commitをfreezeし、実Qwen `full`と`worker-smoke`を生成・検証する。
7. 実staging evidenceがなければreleaseを`hold`にし、PRをready化しない。

## 受入

- AC-007: `full`通常60 decisionだけが適格、strict JSON 100%。
- AC-010: `full`critical 30 decisionだけが適格、全件成功。
- AC-014: 決定的batch契約＋`worker-smoke` 20 child runsの補助証跡。
- AC-017: v2 report/bundleのschema、hash、aggregate、HATE、revisionを独立再検証し、改ざん・欠落・順序変更を拒否。
- AC-018: Code-to-gate strict、HATE upstream、manual-bb real staging、QEG final gate。mock/未実施/欠落はpass不可。
- 旧HAR受入はAC-019、旧Policy/異常系受入はAC-020へ継承する。

## 証跡保存先

- Git: summary report、verification result、bundle SHA、後続訂正、Actions URL。
- GitHub Actions / release: security scan済みsanitized bundle。
- 一時領域のみ: raw run、V8 coverage raw、browser trace、staging auth state。
- Codemap: `docs/acceptance/**/*.{md,json}`をindexし、`.lakda/**`を除外する。