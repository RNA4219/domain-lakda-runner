import { readFileSync } from "node:fs";
import { SCHEMA, validateMap } from "../../vendor/architecture/model.js";
import { architectureTemplate } from "./architecture-template.js";

type Target = string | { from: string; to: string; label: string };
interface ArchitecturePageOptions {
  consoleReturn?: string;
  product?: unknown;
  productSource?: string;
  productError?: string;
  startWithProduct?: boolean;
  report?: {
    title: string;
    body: string;
    behaviors: { title: string; state: string; targets: Target[] }[];
  };
}

const assetDir = new URL("../../vendor/architecture/", import.meta.url);
const readAsset = (name: string) => readFileSync(new URL(name, assetDir), "utf8");
const scriptJson = (value: unknown) => JSON.stringify(value).replaceAll("<", "\\u003c");
const escapeText = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

function loadAssets() {
  const asModule = (name: string) => "data:text/javascript;base64," + Buffer.from(readAsset(name)).toString("base64");
  const imports = { "#lakda-map-model": asModule("model.js"), "#lakda-map-yaml": asModule("yaml/parser.js") };
  const modules = '<script type="importmap">' + scriptJson({ imports }) + '</script>\n' +
    '<script type="module">' + readAsset("map.js") + '</script>\n' +
    '<!--\n' + readAsset("LICENSE") + '\n' + readAsset("yaml/LICENSE") + '\n-->';
  return { modules, sample: JSON.parse(readAsset("sample.json")), platform: JSON.parse(readAsset("platform.json")) };
}

let assets: ReturnType<typeof loadAssets> | undefined;

/** コンソールと、ディスクから直接開ける被覆レポートに同じ図を組み込む。 */
export function renderArchitecturePage(options: ArchitecturePageOptions = {}): string {
  const { sample, platform, modules } = assets ??= loadAssets();
  const { report, productSource = "Lakda の構成定義" } = options;
  let product = null;
  let productError = options.productError;
  if (!productError) {
    try {
      product = { schema: SCHEMA, ...validateMap(options.product === undefined ? platform : options.product) };
    } catch (error) {
      productError = error instanceof Error ? error.message : "構成定義を読み取れません。";
    }
  }
  const slots: Record<string,string> = {
    TITLE: escapeText(report?.title ?? "システム構成図 | Lakda"),
    NAV: report
      ? (options.consoleReturn ? (options.consoleReturn === "/" ? '<a href="/">テスト概要</a>' : '<a href="/">テスト概要</a><a href="'+escapeText(options.consoleReturn).replaceAll('"','&quot;')+'">実行結果</a>') : '')+
        '<a href="#coverage" aria-current="page">'+(options.consoleReturn ? '検証範囲' : '検証結果')+'</a><a href="#architecture">システム構成図</a>'
      : '<a href="/">テスト概要</a><a href="/run">テストを実行</a>',
    COVERAGE: report ? '<section id="coverage" class="coverage" tabindex="-1">' + report.body + '</section>' : '',
    MAP_VISIBILITY: report ? "hidden" : "",
    PRODUCT_LABEL: report || options.product !== undefined || productError ? "対象製品の構成図を開く" : "Lakda の構成図を開く",
    DATA: scriptJson({ sample, product, productError, productSource, startWithProduct: options.startWithProduct === true,
      behaviors: report?.behaviors ?? null }),
    MODULES: modules
  };
  return architectureTemplate.replace(/<!--([A-Z_]+)-->/g, (_, key: string) => slots[key]);
}
