/* global document, location */
import { readFile } from "node:fs/promises";
import { URL, URLSearchParams } from "node:url";

const chrome = new URL("./result-layout.css", import.meta.url);

// 自己完結する HTML 間では、移動元のリンクを URL で引き継ぐ。
function reviewNavigation() {
  const valid = value => /^(?:case|request|history|log|gate)-[0-9a-f]{64}$/.test(value ?? "");
  const from = new URLSearchParams(location.search).get("from");
  const home = document.querySelector('a.home-link[href="index.html"]');
  if (home && valid(from)) {
    home.hash = from;
    if (/^(history|log|gate)-/.test(from)) home.textContent = "← 判定履歴に戻る";
    if (from.startsWith("request-")) home.textContent = "← 判断依頼に戻る";
  }
  return (href, origin = from) => {
    if (!valid(origin)) return href;
    const target = new URL(href, location.href);
    target.searchParams.set("from", origin);
    return target.href;
  };
}

// 保存した HTML だけでも、実行コンソールと同じナビゲーションを描画する。
export async function readResultTemplate(file) {
  const [html, css] = await Promise.all([readFile(file, "utf8"), readFile(chrome, "utf8")]);
  return html.replace("/*RESULT_CHROME*/", () => css).replace("/*REVIEW_NAVIGATION*/", () => reviewNavigation.toString());
}
