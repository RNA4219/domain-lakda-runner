import type { ReportMedia, ReportRow, ReportTimeline, ReportView } from "./types.js";

/** Serialized as a self-contained script; only DOM text APIs render report values. */
export function reportViewer(): void {
  const english = document.documentElement.lang === "en";
  const uiText = (ja: string, en: string, ...values: unknown[]) => (english ? en : ja).replace(/\{(\d+)\}/g, (_, index: string) => String(values[Number(index)]));
  const root = document.getElementById("report")!;
  const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: unknown, className?: string): HTMLElementTagNameMap[K] => {
    const result = document.createElement(tag);
    if (text !== undefined) result.textContent = text === null ? uiText("未取得", "Unavailable") : String(text);
    if (className) result.className = className;
    return result;
  };
  const button = (label: string, action: () => void) => { const result = node("button", label); result.type = "button"; result.addEventListener("click", action); return result; };
  try {
    const view = JSON.parse(document.getElementById("lakda-report-data")!.textContent!) as ReportView;
    if (view.schemaVersion !== "lakda/report-view/v1") throw new Error("unsupported view");
    const runs = new Map(view.runs.map(run => [run.key, run]));
    const sessions = new Map(view.sessions.map(session => [session.sourceId, session]));
    const batches = new Map((view.batches ?? []).map(batch => [batch.sourceId, batch]));
    const incomplete = new Map((view.incompleteRuns ?? []).map(run => [run.sourceId, run]));
    const summaryFor = (row: ReportRow) => row.runKey ? runs.get(row.runKey) : sessions.get(row.sourceId);
    const platform = (row: ReportRow) => summaryFor(row)?.platform ?? uiText("未取得", "Unavailable");
    const mode = (row: ReportRow) => { const summary = summaryFor(row); return incomplete.get(row.sourceId)?.mode ?? (summary && "mode" in summary ? summary.mode : row.kind === "worker" ? "worker" : "session"); };
    let localTime = false;
    const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const date = (at: string | null) => at === null ? uiText("未取得", "Unavailable") : localTime ? new Intl.DateTimeFormat(english ? "en-US" : "ja-JP", { dateStyle: "medium", timeStyle: "medium", timeZone: localZone }).format(new Date(at)) : at.replace("T", " ").replace(".000Z", " UTC").replace(/Z$/, " UTC");
    const statusNames: Record<string, [string, string]> = { passed: ["実行成功", "Execution passed"], failed: ["実行失敗", "Execution failed"], partial: ["一部完了", "Partially completed"], error: ["実行エラー", "Execution error"], failure: ["失敗項目", "Failure item"], warning: ["警告", "Warning"], finding: ["検出事項", "Finding"], unfinalized: ["結果未確定", "Unfinalized"] };
    const statusLabel = (status: string) => Object.hasOwn(statusNames, status) ? uiText(...statusNames[status]) : status;
    const badge = (status: string) => { const element = node("span", statusLabel(status), "badge"); element.dataset.tone = ["failed", "error", "failure"].includes(status) ? "bad" : status === "passed" || status === "ready" ? "good" : "neutral"; return element; };
    const field = (parent: HTMLElement, label: string, value: unknown) => { const item = node("div", undefined, "field"); item.append(node("dt", label), node("dd", value ?? uiText("未取得", "Unavailable"))); parent.append(item); };
    const section = (parent: HTMLElement, title: string) => { const block = node("section"); block.append(node("h2", title)); parent.append(block); return block; };
    const focusHeading = (parent: HTMLElement) => { const heading = parent.querySelector<HTMLElement>("h2:not([hidden]), h3")!; heading.tabIndex = -1; heading.scrollIntoView({ block: "start" }); heading.focus({ preventScroll: true }); };
    const paged = <T>(items: T[], parent: HTMLElement, render: (item: T) => HTMLElement, size: number) => {
      let page = 0;
      const content = node("div", undefined, "items");
      const controls = node("div", undefined, "pager");
      const position = node("span"); position.setAttribute("aria-live", "polite");
      const previous = button(uiText("前のページ", "Previous page"), () => { page -= 1; update(); });
      const next = button(uiText("次のページ", "Next page"), () => { page += 1; update(); });
      const update = () => {
        content.querySelectorAll("video").forEach(video => video.pause());
        content.replaceChildren(...items.slice(page * size, (page + 1) * size).map(render));
        position.textContent = uiText("{0} / {1} ページ", "Page {0} / {1}", page + 1, Math.max(1, Math.ceil(items.length / size)));
        previous.disabled = page === 0; next.disabled = (page + 1) * size >= items.length;
      };
      controls.append(previous, position, next); parent.append(content);
      if (items.length > size) parent.append(controls);
      update();
      return { show: (index: number) => { page = Math.floor(index / size); update(); } };
    };
    root.replaceChildren();
    const meta = node("div", undefined, "report-meta");
    meta.append(node("strong", view.reportId), badge(uiText("生成状態: ", "Generation status: ") + view.generationStatus), badge(view.profile === "local" ? uiText("ローカル確認用", "For local review") : uiText("共有用・区分に従って取扱い", "For sharing; follow classification rules")), badge(uiText("機密区分: ", "Classification: ") + view.classification));
    root.append(meta);
    if (view.generationStatus !== "ready") {
      const title = view.generationStatus === "degraded" ? uiText("レポートの資料不足", "Report limitations") : uiText("レポート生成の問題", "Report generation issue");
      const notice = node("aside", undefined, "generation-notice"); notice.setAttribute("role", "note"); notice.setAttribute("aria-label", title);
      const issue = view.issues.find(item => item.severity !== "info") ?? view.issues[0];
      const reason = issue?.code === "coverage-unavailable" ? uiText("探索coverageは未取得です", "Exploration coverage is unavailable") : issue?.message ?? uiText("一部の結果を確認できません。詳細を確認してください。", "Some results could not be verified. Check the details.");
      const characters = Array.from(reason);
      notice.append(node("strong", title), node("p", characters.length > 160 ? characters.slice(0, 160).join("") + "…" : reason), node("p", uiText("実行の警告件数とは別の、レポート生成時の確認事項です。", "These are report-generation limitations, counted separately from run warnings."), "muted"), button(uiText("不足の詳細を見る", "View limitation details"), () => focusHeading(proof)));
      root.append(notice);
    }
    const summary = section(root, uiText("実行概要", "Run summary"));
    const list = section(root, uiText("結果一覧", "Results"));
    const filters = node("div", undefined, "filters");
    const selects = new Map<string, HTMLSelectElement>();
    const select = (label: string, values: Array<[string, string]>, parent: HTMLElement) => {
      const wrapper = node("label", label); const control = node("select");
      for (const [value, text] of values) { const option = node("option", text); option.value = value; control.append(option); }
      wrapper.append(control); parent.append(wrapper); return control;
    };
    const selectors: Array<[string, (row: ReportRow) => string]> = [[uiText("状態", "Status"), row => row.status], [uiText("対象環境", "Platform"), platform], [uiText("実行モード", "Mode"), mode], [uiText("重要度", "Severity"), row => row.severity ?? uiText("未取得", "Unavailable")]];
    for (const [label, getter] of selectors) {
      const values = [...new Set(view.rows.map(getter))].sort();
      const localized = label === uiText("状態", "Status") || label === uiText("重要度", "Severity");
      selects.set(label, select(label, [["", uiText("すべて", "All")], ...values.map(value => [value, localized ? statusLabel(value) : value] as [string, string])], filters));
    }
    const keywordLabel = node("label", uiText("キーワード", "Keyword")); const keyword = node("input"); keyword.type = "search"; keyword.placeholder = uiText("message・ID・rule", "message / ID / rule");
    keywordLabel.append(keyword); filters.append(keywordLabel);
    const order = select(uiText("表示順", "Sort order"), [["result", uiText("結果順", "By result")], ["newest", uiText("時刻が新しい順", "Newest first")], ["oldest", uiText("時刻が古い順", "Oldest first")]], filters);
    const timezone = select(uiText("表示タイムゾーン", "Display time zone"), [["utc", "UTC"], ["local", uiText("端末のタイムゾーン", "Device time zone")]], filters);
    const currentZone = node("span", "UTC", "zone");
    const filterActions = node("div", undefined, "filter-actions");
    filterActions.append(currentZone, button(uiText("絞り込みを全解除", "Clear all filters"), () => { for (const control of selects.values()) control.value = ""; keyword.value = ""; order.value = "result"; renderRows(); }));
    filters.append(filterActions);
    list.append(node("p", uiText("表示単位: run・worker・session・failure・warning・finding。操作数はテストcase数ではありません。", "Rows represent runs, workers, sessions, failures, warnings and findings. Action counts are not test case counts."), "muted"), filters);
    const count = node("p"); count.setAttribute("aria-live", "polite");
    const resultRows = node("div"); list.append(count, resultRows);
    const detail = node("dialog"); detail.setAttribute("aria-label", uiText("結果の詳細", "Result details"));
    root.append(detail);
    let selectedButton: HTMLButtonElement | undefined;
    detail.addEventListener("close", () => { detail.querySelectorAll("video").forEach(video => video.pause()); selectedButton?.focus(); });
    const showDetail = (row: ReportRow, opener: HTMLButtonElement) => {
      const toolbar = node("div", undefined, "detail-toolbar"); toolbar.append(button(uiText("詳細を閉じる", "Close details"), () => detail.close()));
      const detailHeading = node("div", undefined, "detail-heading"); detailHeading.append(node("h2", row.title), badge(row.kind));
      if (row.kind !== row.status) detailHeading.append(badge(row.status));
      selectedButton = opener; detail.replaceChildren(toolbar, detailHeading);
      const mediaJump = button(uiText("画像・動画へ", "Jump to media"), () => focusHeading(evidence)); mediaJump.className = "media-jump"; toolbar.prepend(mediaJump);
      let selectedHistory: ReportTimeline | undefined; let historyButton: HTMLButtonElement | undefined;
      let showStepRunMedia = false;
      let showAllMedia = ["run", "worker", "session"].includes(row.kind);
      const evidenceNotes = (parent: HTMLElement, notes?: Array<"unavailable" | "not-media">) => {
        for (const note of notes ?? []) parent.append(node("p", note === "unavailable" ? uiText("対応する証跡を確認できません", "Related evidence could not be verified") : uiText("参照先は画像・動画などの媒体ではありません", "The reference is not an image, video or other media"), "muted"));
      };
      const values = node("dl", undefined, "details-grid"); const summary = summaryFor(row);
      const batch = batches.get(row.sourceId); const worker = batch?.workers.find(worker => worker.id === row.id);
      const diagnostic = incomplete.get(row.sourceId);
      const prominentStates: Element[] = [];
      field(values, uiText("メッセージ", "Message"), row.message); values.firstElementChild!.classList.add("message-field");
      field(values, uiText("ルール / 判定項目", "Rule / oracle"), row.ruleId); field(values, uiText("観測日時 (", "Observed at (") + (localTime ? localZone : "UTC") + ")", date(row.at));
      field(values, uiText("項目ID", "Item ID"), row.id);
      field(values, uiText("関連ID", "Related IDs"), row.relatedIds.length ? row.relatedIds.join(" · ") : uiText("記録なし", "Not recorded")); field(values, uiText("seed", "Seed"), worker?.seed ?? diagnostic?.seed ?? summary?.seed);
      if (batch && worker) {
        field(values, uiText("batch ID", "Batch ID"), batch.batchId); field(values, uiText("worker index", "Worker index"), worker.workerIndex);
        field(values, uiText("worker状態", "Worker status"), worker.status === "error" ? uiText("worker実行未完了", "Worker execution incomplete") : uiText("worker処理終了", "Worker processing finished"));
        if (worker.status === "error") prominentStates.push(values.lastElementChild!);
        field(values, uiText("run結果", "Run result"), worker.runUnavailable ? uiText("確定済みrunなし", "No finalized run") : worker.runKey);
        if (worker.runUnavailable) prominentStates.push(values.lastElementChild!);
      }
      field(values, uiText("対象環境", "Platform"), platform(row)); field(values, uiText("実行モード", "Mode"), mode(row)); field(values, uiText("実行資格", "Execution mode"), summary?.executionMode);
      field(values, uiText("受入状態", "Acceptance status"), summary?.acceptanceStatus); field(values, uiText("producer revision", "Producer revision"), diagnostic?.producerRevision ?? summary?.producerRevision); field(values, uiText("target revision", "Target revision"), summary?.targetRevision);
      if (summary) {
        field(values, uiText("開始", "Started"), date(summary.startedAt)); field(values, uiText("終了", "Ended"), date(summary.endedAt)); field(values, uiText("記録された所要時間 (ms)", "Recorded duration (ms)"), summary.durationMs);
        if ("sessionId" in summary) { field(values, uiText("session状態", "Session status"), summary.status); field(values, uiText("technical outcome", "Technical outcome"), summary.technicalOutcome); field(values, uiText("累積action数", "Cumulative actions"), summary.actionCount); field(values, uiText("active duration (ms)", "Active duration (ms)"), summary.activeDurationMs); }
        else { field(values, uiText("観測済みattempt数", "Observed action attempts"), summary.actionCount); field(values, uiText("計画action数", "Planned actions"), summary.plannedActionCount); }
      }
      if (diagnostic) {
        field(values, uiText("結果", "Result"), uiText("未確定", "Unfinalized")); prominentStates.push(values.lastElementChild!);
        field(values, uiText("開始", "Started"), date(diagnostic.startedAt)); field(values, uiText("終了", "Ended"), null); field(values, uiText("記録された所要時間 (ms)", "Recorded duration (ms)"), null);
        field(values, uiText("観測済みattempt数", "Observed action attempts"), null); field(values, uiText("計画action数", "Planned actions"), null); field(values, uiText("failure数", "Failures"), null);
        field(values, uiText("worker index", "Worker index"), diagnostic.workerIndex); field(values, uiText("batch ID", "Batch ID"), diagnostic.batchId);
      }
      field(values, uiText("停止理由", "Stop reason"), summary?.terminationReason);
      const primary = node("dl", undefined, "primary-message"); primary.append(values.firstElementChild!, ...prominentStates); detail.append(primary);
      const messageText = primary.querySelector("dd")!; messageText.tabIndex = 0;
      const workspace = node("div", undefined, "step-workspace"); detail.append(workspace);
      const technical = node("details", undefined, "technical-details"); technical.append(node("summary", uiText("技術情報・実行記録", "Technical details and run records")), values); detail.append(technical);
      const timeline = section(workspace, uiText("操作・event履歴", "Action and event history")); timeline.className = "step-list";
      const detailSourceId = row.kind === "worker" && row.runKey ? runs.get(row.runKey)!.sourceId : row.sourceId;
      const events = view.timeline.filter(event => row.runKey ? event.runKey === row.runKey && event.sourceId === detailSourceId : event.sourceId === detailSourceId).sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id));
      timeline.append(node("p", diagnostic ? uiText("操作履歴は未取得です。開始記録には実行件数を含みません。", "Action history is unavailable. The start record does not include execution counts.") : events.length + uiText(" 件 · 元sequence順 · 計画は実行済みを意味しません", " items · Original sequence order · Planned steps do not imply execution"), "muted"));
      if (!events.length && !diagnostic) timeline.append(node("p", uiText("保存された履歴はありません", "No saved history")));
      const stepNames: Record<string, [string, string]> = { click: ["クリック", "Click"], tap: ["タップ", "Tap"], fill: ["入力", "Enter text"], press: ["キー操作", "Press key"], navigate: ["ページ移動", "Navigate"], goto: ["ページ移動", "Navigate"], check: ["チェック", "Check"], select: ["選択", "Select"], assert: ["判定", "Assertion"], oracle: ["判定", "Assertion"], observation: ["画面の観測", "Observe screen"], candidate: ["操作候補", "Action candidate"], execution: ["操作の実行", "Execute action"], "operator-bookmark": ["証跡の保存", "Save evidence"], "candidate-denied": ["操作の拒否", "Action denied"] };
      const statusNames: Record<string, [string, string]> = { executed: ["実行済み", "Executed"], completed: ["完了", "Completed"], failed: ["失敗", "Failed"], fail: ["失敗", "Failed"], pass: ["合格", "Passed"], planned: ["計画", "Planned"], candidate: ["要確認", "Needs review"], confirmed: ["確認済み", "Confirmed"], inconclusive: ["判定保留", "Inconclusive"], denied: ["拒否", "Denied"], unsupported: ["未対応", "Unsupported"], timeout: ["時間切れ", "Timed out"], target_lost: ["対象との接続切れ", "Target lost"], action_failed: ["操作失敗", "Action failed"], infrastructure_error: ["実行環境エラー", "Infrastructure error"] };
      const translated = (names: Record<string, [string, string]>, value: string) => names[value] ? uiText(...names[value]) : value;
      const stepTitle = (event: ReportTimeline) => event.step ? translated(stepNames, event.step.operation ?? event.kind) + (event.step.target ? " · " + event.step.target : "") : event.label === event.kind ? translated(stepNames, event.kind) : event.label;
      const isFailure = (event: ReportTimeline) => ["failed", "fail", "timeout", "target_lost", "action_failed", "infrastructure_error"].includes(event.step?.status ?? "");
      const statusBadge = (event: ReportTimeline) => { const status = event.step?.status; const mark = badge(status ? translated(statusNames, status) : uiText("未取得", "Unavailable")); mark.dataset.tone = isFailure(event) ? "bad" : status === "pass" || status === "completed" ? "good" : "neutral"; return mark; };
      const historyControls = new Map<string, HTMLButtonElement>();
      const selectStep = (index: number) => {
        selectedHistory = events[index]; showStepRunMedia = false; historyPager.show(index); historyButton = historyControls.get(selectedHistory.id);
        renderEvidence(); historyButton?.scrollIntoView({ block: "nearest", inline: "nearest" });
        const heading = mediaBody.querySelector("h3")!; heading.focus({ preventScroll: true });
        if (window.innerWidth <= 800) heading.scrollIntoView({ block: "start" }); else { evidence.scrollTop = 0; workspace.scrollIntoView({ block: "nearest" }); }
      };
      const failureIndex = events.findIndex(isFailure);
      if (failureIndex >= 0) toolbar.prepend(button(uiText("失敗した手順へ", "Jump to failed step"), () => selectStep(failureIndex)));
      const historyPager = paged(events, timeline, event => {
        const name = event.evidenceIds.length ? uiText("#{0} の証跡を見る ({1}件)", "View evidence for #{0} ({1})", event.sequence, event.evidenceIds.length) : uiText("#{0} の手順を見る", "View step #{0}", event.sequence);
        const control = button(name, () => selectStep(events.indexOf(event))); control.className = "timeline-item step-choice"; control.setAttribute("aria-label", name); control.setAttribute("aria-pressed", String(selectedHistory?.id === event.id));
        const label = node("span", stepTitle(event)); label.dataset.timelineLabel = "";
        control.replaceChildren(node("strong", "#" + event.sequence), label, statusBadge(event)); historyControls.set(event.id, control);
        if (event.step?.durationMs !== null && event.step?.durationMs !== undefined) control.append(node("small", event.step.durationMs + " ms"));
        const item = node("div"); item.append(control); evidenceNotes(item, event.evidenceNotes); return item;
      }, 100);
      const coverage = section(technical, uiText("探索coverage", "Exploration coverage"));
      const metrics = summary && "coverage" in summary ? summary.coverage : [];
      if (!metrics.length) coverage.append(node("p", uiText("未取得。異なるrunの分母は合算しません。", "Unavailable. Denominators from different runs are not combined.")));
      for (const metric of metrics) {
        const item = node("div", undefined, "coverage-item"); item.append(node("h3", metric.name));
        item.append(node("strong", metric.status !== "recorded" ? metric.status === "not-applicable" ? uiText("対象外", "Not applicable") : uiText("未取得", "Unavailable") : metric.denominator === 0 ? uiText("0 / 0 — 評価対象なし", "0 / 0 — Nothing to evaluate") : metric.numerator + " / " + metric.denominator + " — " + ((metric.ratio ?? 0) * 100).toFixed(1) + "%"));
        item.append(node("p", metric.definition), node("small", uiText("対象範囲: ", "Scope: ") + metric.scope)); coverage.append(item);
      }
      const evidence = section(workspace, uiText("媒体・参照証跡", "Media and referenced evidence")); evidence.className = "step-evidence";
      const childRuns = new Set(sessions.get(row.sourceId)?.runKeys ?? []);
      const items = view.media.filter(item => row.runKey ? item.runKey === row.runKey : item.sourceId === row.sourceId || item.runKey !== null && childRuns.has(item.runKey));
      items.sort((a, b) => a.sourceId.localeCompare(b.sourceId) || a.kind.localeCompare(b.kind) || (a.sequence ?? -1) - (b.sequence ?? -1) || a.id.localeCompare(b.id));
      const mediaBody = node("div"); evidence.append(mediaBody);
      const videoCards = new Map<string, HTMLElement>();
      const renderCard = (item: ReportMedia) => {
        const cached = videoCards.get(item.id); if (cached) return cached;
        const card = node("article", undefined, "media-card");
        const mediaHeading = node("div", undefined, "media-heading"); mediaHeading.append(node("h3", item.kind + (item.sequence === null ? "" : " #" + item.sequence)), badge(item.verification === "pending" ? uiText("未検査・共有対象外", "Unverified; excluded from sharing") : item.verification === "excluded" ? uiText("除外", "Excluded") : uiText("検証済み媒体", "Verified media"))); card.append(mediaHeading);
        const mediaInfo = node("details", undefined, "media-info"); mediaInfo.open = !item.path; mediaInfo.append(node("summary", uiText("媒体の詳細", "Media details")), node("p", item.scope === "run" ? uiText("実行全体の証跡・項目との対応記録なし", "Evidence for the entire run; no recorded link to an individual item") : uiText("保存された項目への対応記録があります", "A link to the recorded item is available")), node("small", uiText("所属: ", "Belongs to: ") + (item.runKey ?? item.sourceId)));
        if (item.reason) mediaInfo.append(node("p", uiText("理由: ", "Reason: ") + item.reason));
        if (item.proof) {
          const proof = node("details"); proof.append(node("summary", uiText("検証に使った記録", "Records used for verification")));
          const facts = node("dl");
          for (const [label, value] of [[uiText("検査契約", "Verification contract"), item.proof.schemaVersion], [uiText("処理", "Decision"), item.proof.decision], [uiText("検査記録SHA-256", "Attestation SHA-256"), item.proof.attestationSha256], [uiText("署名対象digest", "Signed payload digest"), item.proof.signedPayloadDigest], [uiText("鍵一覧SHA-256", "Trust store SHA-256"), item.proof.trustStoreSha256], [uiText("署名鍵IDのdigest", "Signing key ID digest"), item.proof.keyIdDigest], [uiText("検査policy digest", "Verification policy digest"), item.proof.policyDigest]]) field(facts, label, value);
          for (const digest of item.proof.targetManifestSha256s) field(facts, uiText("対象manifest SHA-256", "Target manifest SHA-256"), digest);
          if (item.proof.schemaVersion === "lakda/binary-artifact-attestation/v2") {
            field(facts, uiText("要求SHA-256", "Request SHA-256"), item.proof.requestSha256); field(facts, uiText("受領記録SHA-256", "Receipt SHA-256"), item.proof.receiptSha256);
          }
          proof.append(facts, node("p", uiText("生成時に保存済み媒体と検査記録を照合した結果です。現在の対象操作や実環境受入の承認を示すものではありません。", "Saved media and verification records were checked at generation time. This does not authorize current target operations or real-environment acceptance."))); mediaInfo.append(proof);
        }
        if (!item.path || !/^assets\/[a-f0-9]{64}\.(?:png|jpg|gif|webp|webm|mp4|zip)$/.test(item.path)) { card.append(mediaInfo); return card; }
        const link = node("a", uiText("媒体fileを保存", "Save media file")); link.href = item.path; link.download = item.path.split("/").pop()!;
        if (item.kind === "trace") card.append(node("p", uiText("trace ZIPは既存のPlaywright trace viewerで開いてください。ここでは実行しません。", "Open the trace ZIP in the existing Playwright trace viewer. It is not executed here.")), node("code", 'npx playwright show-trace "' + item.path + '"'));
        else if (item.kind === "video") {
          videoCards.set(item.id, card);
          const video = node("video"); video.controls = true; video.preload = "none"; video.src = item.path;
          const controls = node("div", undefined, "video-controls");
          const status = node("p", undefined, "muted"); status.hidden = true; status.setAttribute("role", "status");
          const play = button(uiText("動画を再生", "Play video"), () => {
            if (!video.paused) { video.pause(); return; }
            status.hidden = true;
            void video.play().catch(error => {
              if (video.error || error?.name === "AbortError") return;
              status.textContent = uiText("再生できませんでした。もう一度再生するか、媒体fileを保存してください。", "Playback could not start. Try again or save the media file."); status.hidden = false; sync();
            });
          });
          const seek = node("input"); seek.type = "range"; seek.min = "0"; seek.max = "1"; seek.step = "0.1"; seek.value = "0"; seek.disabled = true;
          const seekLabel = node("label", uiText("再生位置", "Playback position")); seekLabel.append(seek);
          const time = node("small");
          const clock = (value: number) => Math.floor(value / 60) + ":" + String(Math.floor(value % 60)).padStart(2, "0");
          const extent = () => Number.isFinite(video.duration) && video.duration > 0 ? video.duration : video.seekable.length ? video.seekable.end(video.seekable.length - 1) : 0;
          const sync = () => {
            const end = extent(); const available = Number.isFinite(end) && end > 0 && !video.error;
            play.textContent = video.paused ? uiText("動画を再生", "Play video") : uiText("一時停止", "Pause video"); play.disabled = Boolean(video.error);
            seek.disabled = !available; seek.max = String(available ? end : 1); seek.value = String(video.currentTime);
            time.textContent = clock(video.currentTime) + " / " + (available ? clock(end) : "--:--"); seek.setAttribute("aria-valuetext", time.textContent);
          };
          seek.addEventListener("input", () => { if (!seek.disabled) { video.currentTime = Math.min(Number(seek.value), extent()); sync(); } });
          for (const event of ["play", "pause", "ended", "timeupdate", "durationchange", "loadedmetadata", "loadeddata", "progress", "emptied"]) video.addEventListener(event, sync);
          video.addEventListener("error", () => {
            status.textContent = uiText("このブラウザでは動画を表示できません。媒体fileで確認してください。", "This browser cannot display the video. Check the media file."); status.hidden = false; sync();
          }, { once: true });
          controls.append(play, seekLabel, time); card.append(video, controls, status); sync();
        } else {
          const img = node("img"); img.alt = item.kind + (item.sequence === null ? "" : " #" + item.sequence); img.loading = "lazy"; img.decoding = "async"; img.src = item.path;
          img.addEventListener("error", () => card.append(node("p", uiText("このブラウザでは画像を表示できません。媒体fileで確認してください。", "This browser cannot display the image. Check the media file."))), { once: true });
          const viewport = node("div", undefined, "image-viewport"); viewport.append(img);
          const zoom = button(uiText("画像を拡大", "Enlarge image"), () => {
            const expanded = img.classList.toggle("expanded"); zoom.setAttribute("aria-expanded", String(expanded)); zoom.textContent = expanded ? uiText("画像を縮小", "Fit image") : uiText("画像を拡大", "Enlarge image");
            if (expanded) { viewport.tabIndex = 0; viewport.setAttribute("role", "region"); viewport.setAttribute("aria-label", uiText("拡大画像", "Enlarged image")); viewport.focus(); }
            else { for (const attribute of ["tabindex", "role", "aria-label"]) viewport.removeAttribute(attribute); viewport.scrollTo(0, 0); zoom.focus(); }
          }); zoom.setAttribute("aria-expanded", "false"); card.append(viewport, zoom);
        }
        card.append(link, mediaInfo); return card;
      };
      const renderEvidence = () => {
        mediaBody.querySelectorAll("video").forEach(video => video.pause());
        mediaBody.replaceChildren();
        evidence.querySelector("h2")!.hidden = Boolean(selectedHistory);
        const title = node("h3", selectedHistory ? uiText("選択した履歴: #", "Selected history: #") + selectedHistory.sequence + " · " + stepTitle(selectedHistory) : showAllMedia ? uiText("実行全体の証跡", "Evidence for the entire run") : uiText("この項目の証跡", "Evidence for this item")); title.tabIndex = -1;
        const stepSummary = node("div", undefined, "step-summary"); stepSummary.append(title); mediaBody.append(stepSummary);
        const linked = selectedHistory ? items.filter(item => selectedHistory!.evidenceIds.includes(item.id)) : [];
        if (selectedHistory) {
          stepSummary.append(statusBadge(selectedHistory));
          if (selectedHistory.step?.message) stepSummary.append(node("p", selectedHistory.step.message, "step-message"));
          const index = events.indexOf(selectedHistory); const navigation = node("div", undefined, "step-nav");
          const previous = button(uiText("前の手順", "Previous step"), () => selectStep(index - 1)); previous.disabled = index === 0;
          const next = button(uiText("次の手順", "Next step"), () => selectStep(index + 1)); next.disabled = index === events.length - 1;
          navigation.append(previous, next, button(uiText("履歴の選択を解除", "Clear history selection"), () => {
            const restore = historyButton; selectedHistory = undefined; showStepRunMedia = false; historyButton = undefined; renderEvidence();
            timeline.querySelectorAll("[aria-pressed]").forEach(control => control.setAttribute("aria-pressed", "false"));
            if (restore?.isConnected) restore.focus(); else { const heading = timeline.querySelector("h2")!; heading.tabIndex = -1; heading.focus(); }
          })); mediaBody.append(navigation);
          if (!linked.length && items.length) {
            mediaBody.append(button(showStepRunMedia ? uiText("この手順の証跡へ戻る", "Back to evidence for this step") : uiText("実行全体の証跡を見る (", "Show evidence for the entire run (") + items.length + uiText("件)", " items)"), () => { showStepRunMedia = !showStepRunMedia; renderEvidence(); mediaBody.querySelector("h3")?.focus({ preventScroll: true }); }));
            if (showStepRunMedia) mediaBody.append(node("p", uiText("実行全体の証跡です。この手順との対応は未確認です。", "Evidence for the entire run. Its relationship to this step is unconfirmed."), "muted"));
          }
        } else if (!["run", "worker", "session"].includes(row.kind)) {
          mediaBody.append(button(showAllMedia ? uiText("この項目の証跡へ戻る", "Back to evidence for this item") : uiText("実行全体の証跡を見る (", "Show evidence for the entire run (") + items.length + uiText("件)", " items)"), () => { showAllMedia = !showAllMedia; renderEvidence(); mediaBody.querySelector("h3")?.focus(); }));
        }
        const selected = selectedHistory ? showStepRunMedia ? items : linked : showAllMedia ? items : items.filter(item => row.evidenceIds.includes(item.id));
        evidenceNotes(mediaBody, selectedHistory?.evidenceNotes ?? (!showAllMedia ? row.evidenceNotes : undefined));
        mediaBody.append(node("p", uiText("表示可能 ", "Available ") + selected.filter(item => item.path !== null).length + uiText("件 · 除外 ", " items · Excluded ") + selected.filter(item => item.path === null).length + uiText("件", " items"), "muted"));
        if (!selected.length) mediaBody.append(node("p", diagnostic ? uiText("未確定runの媒体は検証できないため表示しません。", "Media from unfinalized runs cannot be verified and is not displayed.") : selectedHistory ? uiText("この手順で表示できる保存媒体はありません。", "No saved media can be displayed for this step.") : !showAllMedia ? uiText("この項目に対応する保存媒体はありません。実行全体の証跡も確認できます。", "No saved media is linked to this item. You can also check evidence for the entire run.") : uiText("保存媒体なし（欠落・非保持の理由は記録されていません）", "No saved media (the reason for absence or non-retention was not recorded)")));
        paged(selected, mediaBody, renderCard, 20);
        if (selectedHistory) {
          const record = node("details"); record.append(node("summary", uiText("手順の元の記録", "Original step record")));
          const facts = node("dl"); field(facts, uiText("元のラベル", "Original label"), selectedHistory.label); field(facts, uiText("元の状態", "Original status"), selectedHistory.step?.status); field(facts, uiText("観測日時", "Observed at"), date(selectedHistory.at)); field(facts, uiText("所要時間 (ms)", "Duration (ms)"), selectedHistory.step?.durationMs); field(facts, uiText("関連ID", "Related IDs"), selectedHistory.relatedIds.join(" · ")); record.append(facts); mediaBody.append(record);
        }
      };
      renderEvidence();
      detail.showModal();
    };
    const renderSummary = () => {
      const expanded = summary.querySelector<HTMLDetailsElement>(".summary-more")?.open ?? false;
      const heading = node("header", undefined, "section-heading");
      heading.append(node("h2", uiText("実行概要", "Run summary")), node("p", uiText("生成日時: ", "Generated at: ") + date(view.generatedAt), "muted"));
      summary.replaceChildren(heading);
      const cards = node("div", undefined, "summary-cards");
      for (const outcome of ["passed", "failed", "partial", "error"] as const) { const card = node("div", undefined, "summary-card"); card.append(badge(outcome), node("strong", view.counts.outcomes[outcome]), node("small", uiText("実行", "runs"))); cards.append(card); }
      summary.append(cards);
      const facts = node("dl", undefined, "summary-facts");
      for (const [label, value] of [[uiText("実行数", "Runs"), view.counts.runs], [uiText("失敗項目", "Failures"), view.counts.failures], [uiText("実行の警告", "Run warnings"), view.counts.warnings], [uiText("検出事項", "Findings"), view.counts.findings]]) field(facts, String(label), value);
      summary.append(facts);
      if (view.counts.workerIncomplete) summary.append(node("p", uiText("未完了のワーカー: ", "Incomplete workers: ") + view.counts.workerIncomplete, "notice"));
      if (view.counts.incompleteRuns) {
        const diagnosis = node("dl", undefined, "details-grid"); field(diagnosis, uiText("結果未確定run", "Unfinalized runs"), view.counts.incompleteRuns);
        summary.append(diagnosis, node("p", uiText("上の件数は確定済みrunの集計です。結果未確定runの合否・操作数・失敗数は含めません。開始記録だけでは実行中と異常終了を区別できません。", "The counts above summarize finalized runs. Outcomes, actions and failures of unfinalized runs are excluded. A start record alone cannot distinguish an active run from an abnormal exit."), "notice"));
      }
      for (const batch of view.batches ?? []) {
        const block = section(summary, uiText("worker batch", "Worker batch")); const values = node("dl", undefined, "details-grid");
        field(values, uiText("batch ID", "Batch ID"), batch.batchId); field(values, uiText("batch結果", "Batch result"), batch.outcome); field(values, uiText("元の終了code", "Original exit code"), batch.exitCode);
        field(values, uiText("要求worker数", "Requested workers"), batch.requestedWorkers); field(values, uiText("処理終了worker数", "Workers with finished processing"), batch.completedWorkers); field(values, uiText("結果記録日時", "Result recorded at"), date(batch.recordedAt));
        block.append(values, node("p", uiText("処理終了数はrunの合格数ではありません。run未確定のworkerは未完了にも数えます。", "Finished processing does not mean a run passed. Workers without finalized runs are also counted as incomplete."), "muted"));
      }
      if (!view.runs.length) summary.append(node("p", uiText("確定した実行結果なし", "No finalized execution results")));
      const more = node("details", undefined, "summary-more"); more.open = expanded;
      more.append(node("summary", uiText("操作件数・実行時間など", "Action counts, timing and more")));
      const supporting = node("dl", undefined, "details-grid");
      for (const [label, value] of [[uiText("未完了のワーカー", "Incomplete workers"), view.counts.workerIncomplete], [uiText("実行を試みた操作数", "Observed action attempts"), view.counts.actions], [uiText("計画した操作数", "Planned actions"), view.counts.plannedActions], [uiText("操作件数が不明な実行", "Runs with unknown action counts"), view.counts.unknownActionRuns], [uiText("セッション数", "Sessions"), view.sessions.length], [uiText("除外媒体", "Excluded media"), view.counts.excludedMedia]]) field(supporting, String(label), value);
      more.append(supporting);
      if (view.runs.length) {
        const starts = view.runs.map(run => run.startedAt).sort(); const ends = view.runs.map(run => run.endedAt).sort();
        more.append(node("p", uiText("実行時間範囲: ", "Execution time range: ") + date(starts[0]) + " 〜 " + date(ends[ends.length - 1])));
        more.append(node("p", uiText("記録されたrun所要時間の合計: ", "Sum of recorded run durations: ") + view.runs.reduce((sum, run) => sum + (run.durationMs ?? 0), 0) + uiText(" ms（取得 ", " ms (recorded ") + view.runs.filter(run => run.durationMs !== null).length + "/" + view.runs.length + uiText(" run。並列・pauseを含む経過時間とは別）", " runs; differs from elapsed time including parallel execution and pauses)"), "muted"));
      }
      summary.append(more);
      summary.append(node("p", uiText("受入判定: このレポートでは判定しません。実行資格・受入状態は各結果の詳細を確認してください。", "Acceptance decision: not determined by this report. Check execution mode and acceptance status in each result."), "notice"));
    };
    const renderRows = () => {
      const words = keyword.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
      const rows = view.rows.filter(row => selectors.every(([label, getter]) => !selects.get(label)!.value || selects.get(label)!.value === getter(row)) && words.every(word => [row.title, row.message, row.status, statusLabel(row.status), row.ruleId, row.id, ...row.relatedIds].join(" ").toLocaleLowerCase().includes(word)));
      if (order.value !== "result") rows.sort((a, b) => a.at === null ? b.at === null ? a.id.localeCompare(b.id) : 1 : b.at === null ? -1 : (order.value === "newest" ? b.at.localeCompare(a.at) : a.at.localeCompare(b.at)) || a.id.localeCompare(b.id));
      count.textContent = rows.length + " / " + view.rows.length + uiText(" 件", " items"); resultRows.replaceChildren();
      if (!rows.length) resultRows.append(node("p", uiText("該当する結果はありません", "No matching results"), "empty"));
      paged(rows, resultRows, row => {
        const control = button("", () => showDetail(row, control)); control.className = "result-row"; control.setAttribute("aria-label", uiText("表示する: ", "Show: ") + row.title);
        const content = node("span", undefined, "row-content"); content.append(node("strong", row.title));
        if (row.message && row.message !== row.title) content.append(node("span", row.message, "row-message"));
        content.append(node("span", row.kind + " · " + platform(row) + " · " + mode(row), "muted"));
        control.append(badge(row.status), content, node("small", date(row.at))); return control;
      }, 25);
    };
    for (const control of [...selects.values(), order]) control.addEventListener("change", renderRows);
    keyword.addEventListener("input", renderRows);
    timezone.addEventListener("change", () => { localTime = timezone.value === "local"; currentZone.textContent = localTime ? localZone : "UTC"; renderSummary(); renderRows(); });
    const proof = section(root, uiText("根拠・未確認事項", "Evidence and limitations"));
    proof.append(node("p", uiText("生成時の入力検証。ブラウザ表示だけでは現在の入力やbundle全bytesを再検証しません。", "Inputs were verified at generation time. Displaying this page does not re-verify current inputs or every byte in the bundle.")), node("p", uiText("producer: ", "Producer: ") + view.producerVersion + uiText(" · 明示入力 ", " · Explicit inputs ") + view.counts.sources + uiText(" · 参照展開後 ", " · Expanded sources ") + view.sources.length + uiText(" · 重複除去 ", " · Duplicates removed ") + view.counts.duplicateSources));
    for (const source of view.sources) {
      const block = node("details"); block.append(node("summary", source.id + " · " + source.status + " · " + source.classification));
      const values = node("dl", undefined, "details-grid");
      field(values, uiText("入力区分", "Input kind"), view.inputSourceIds.includes(source.id) ? uiText("明示入力", "Explicit input") : uiText("参照から展開", "Expanded from a reference")); field(values, uiText("manifest SHA-256", "Manifest SHA-256"), source.manifestSha256); field(values, uiText("event head digest", "Event head digest"), source.eventHeadDigest); field(values, uiText("producer revision", "Producer revision"), source.producerRevision); field(values, uiText("target revision", "Target revision"), source.targetRevision);
      if (source.kind === "batch") field(values, uiText("batch index SHA-256", "Batch index SHA-256"), source.indexSha256);
      if (source.startRecordSha256) field(values, uiText("開始記録 SHA-256", "Start record SHA-256"), source.startRecordSha256);
      const copied = node("span"); copied.setAttribute("aria-live", "polite");
      block.append(values, button(uiText("IDとdigestをコピー", "Copy ID and digest"), () => { void navigator.clipboard?.writeText(source.id + "\n" + (source.indexSha256 ? "batch index: " + source.indexSha256 : source.startRecordSha256 ? "start record: " + source.startRecordSha256 : source.manifestSha256 ?? uiText("未取得", "Unavailable"))).then(() => { copied.textContent = uiText("コピーしました", "Copied"); }).catch(() => { copied.textContent = uiText("コピーできません。表示された文字を選択してください。", "Copy failed. Select the displayed text instead."); }); }), copied); proof.append(block);
    }
    for (const issue of view.issues) proof.append(node("p", issue.severity + " · " + issue.code + " · " + issue.message));
    for (const item of view.media.filter(item => item.verification === "excluded")) proof.append(node("p", uiText("除外媒体: ", "Excluded media: ") + item.id + " · " + item.reason));
    renderSummary(); renderRows();
  } catch {
    root.replaceChildren(node("p", uiText("表示データを読み込めません。report verifyでレポート一式を確認してください。", "Report data could not be loaded. Run report verify to check the bundle."), "notice"));
  }
}
