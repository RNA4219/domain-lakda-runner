import type { Frame, Page } from "playwright";
import type { LocatorScope } from "../../adaptive/contracts.js";

export type Target = Page | Frame;
export type ScopeHint = { boundary: LocatorScope["boundary"]; role: string; testId?: string; name?: string; identifierHash?: string; keySource: LocatorScope["keySource"]; };
export type Control = { ordinal: number; actionKind: "click" | "fill" | "check" | "select"; role?: string; name?: string; testId?: string; fieldId?: string; href?: string; actionId?: string; declaredMutationKind?: string; formMethod?: string; hint: string; disabled: boolean; scopeHints: ScopeHint[] };
export type DisplayElement = { role: "heading" | "dialog" | "alert" | "status"; name: string; modal?: true; open?: boolean; level?: number };
export async function collectControls(target: Target): Promise<Control[]> {
    return target.evaluate(() => {
      const text = (element: Element | null): string => ((element as HTMLElement | null)?.innerText ?? element?.textContent ?? "").replace(/\s+/g, " ").trim();
      const role = (element: Element): string | undefined => {
        if (element.getAttribute("role")) return element.getAttribute("role")!;
        if (element instanceof HTMLButtonElement) return "button";
        if (element instanceof HTMLAnchorElement && element.href) return "link";
        if (element instanceof HTMLSelectElement) return "combobox";
        if (element instanceof HTMLTextAreaElement) return "textbox";
        if (element instanceof HTMLInputElement) { if (element.type === "checkbox") return "checkbox"; if (["button", "submit", "reset", "image"].includes(element.type)) return "button"; if (element.type !== "hidden") return "textbox"; }
        return (element as HTMLElement).isContentEditable ? "textbox" : undefined;
      };
      const name = (element: Element): string => {
        const aria = element.getAttribute("aria-label") ?? element.getAttribute("title"); if (aria) return aria.trim();
        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) { const labels = [...element.labels ?? []].map(label => text(label)).filter(Boolean); if (labels.length) return labels.join(" "); if (element.getAttribute("placeholder")) return element.getAttribute("placeholder")!.trim(); }
        return text(element);
      };
      const action = (value: string): Control["actionKind"] | undefined => value === "checkbox" ? "check" : value === "combobox" ? "select" : value === "textbox" ? "fill" : ["button", "link", "menuitem", "tab", "option"].includes(value) ? "click" : undefined;
      const scopeHints = (element: Element): ScopeHint[] => {
        const result: ScopeHint[] = [];
        for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
          const explicit = parent.getAttribute("role");
          const boundary = explicit === "row" ? "row" : explicit === "listitem" ? "listitem" : explicit === "dialog" ? "dialog" : parent instanceof HTMLTableRowElement ? "row" : parent instanceof HTMLLIElement ? "listitem" : parent instanceof HTMLDialogElement ? "dialog" : parent.tagName.toLowerCase() === "article" || parent.getAttribute("data-lakda-scope") === "card" ? "card" : undefined;
          if (!boundary) continue;
          const scopeRole = boundary === "card" ? "article" : boundary;
          const heading = text(parent.querySelector("h1,h2,h3,h4,h5,h6,[role='heading']"));
          const accessible = (parent.getAttribute("aria-label") ?? parent.getAttribute("title") ?? "").trim();
          const testId = parent.getAttribute("data-testid")?.trim() || undefined;
          const stableKey = parent.getAttribute("data-lakda-scope-key")?.trim().toLowerCase();
          const identifierHash = stableKey && /^[0-9a-f]{64}$/.test(stableKey) ? stableKey : undefined;
          const scopeName = heading || accessible || undefined;
          result.push({ boundary, role: scopeRole, ...(testId ? { testId } : {}), ...(scopeName ? { name: scopeName } : {}), ...(identifierHash ? { identifierHash } : {}), keySource: testId ? "test-id" : scopeName ? "heading" : "identifier-hash" });
        }
        return result;
      };
      const query = "button,a[href],input,textarea,select,[role='button'],[role='link'],[role='textbox'],[role='checkbox'],[role='combobox'],[role='menuitem'],[role='tab']";
      return [...new Set([...document.querySelectorAll(query)])].flatMap((element, ordinal) => {
        const html = element as HTMLElement; const rect = html.getBoundingClientRect(); const style = getComputedStyle(html); const r = role(element); const a = r ? action(r) : undefined;
        if (!r || !a || rect.width <= 0 || rect.height <= 0 || style.display === "none" || style.visibility === "hidden" || html.hidden || element.getAttribute("aria-hidden") === "true") return [];
        const fieldId = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement
          ? element.id || element.getAttribute("data-testid") || element.getAttribute("name") || (element.form ? `field-${[...element.form.elements].indexOf(element)}` : undefined)
          : undefined;
        const disabled = (element instanceof HTMLInputElement || element instanceof HTMLButtonElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) && element.disabled || element.getAttribute("aria-disabled") === "true";
        const actionId = element.getAttribute("data-lakda-action-id")?.trim() || undefined;
        const declaredMutationKind = element.getAttribute("data-lakda-mutation-kind")?.trim().toLowerCase() || undefined;
        const explicitMethod = element.getAttribute("data-lakda-http-method")?.trim().toLowerCase() || undefined;
        const submitter = (element instanceof HTMLButtonElement || element instanceof HTMLInputElement) && Boolean(element.form) && ["submit", "image"].includes(element.type);
        const formMethod = explicitMethod ?? (submitter ? (element.getAttribute("formmethod") ?? element.form?.getAttribute("method") ?? "get").trim().toLowerCase() : undefined);
        return [{ ordinal, actionKind: a, role: r, name: name(element), testId: element.getAttribute("data-testid") ?? undefined, fieldId, href: element instanceof HTMLAnchorElement ? element.href : undefined, ...(actionId ? { actionId } : {}), ...(declaredMutationKind ? { declaredMutationKind } : {}), ...(formMethod ? { formMethod } : {}), hint: `${name(element)} ${element.getAttribute("type") ?? ""}`, disabled, scopeHints: scopeHints(element) }];
      });
    });
  }
export async function collectDisplayElements(target: Target): Promise<DisplayElement[]> {
    return target.evaluate(() => {
      const selector = "h1,h2,h3,h4,h5,h6,dialog,[role='heading'],[role='dialog'],[role='alert'],[role='status']";
      return [...document.querySelectorAll(selector)].flatMap(element => {
        const html = element as HTMLElement; const rect = html.getBoundingClientRect(); const style = getComputedStyle(html);
        if (rect.width <= 0 || rect.height <= 0 || style.display === "none" || style.visibility === "hidden" || html.hidden || element.getAttribute("aria-hidden") === "true") return [];
        const explicit = element.getAttribute("role");
        const tag = element.tagName.toLowerCase();
        const role = explicit === "heading" || explicit === "dialog" || explicit === "alert" || explicit === "status"
          ? explicit : /^h[1-6]$/.test(tag) ? "heading" : tag === "dialog" ? "dialog" : undefined;
        if (!role) return [];
        const name = (element.getAttribute("aria-label") ?? html.innerText ?? element.textContent ?? "").replace(/\s+/g, " ").trim();
        const level = role === "heading" ? Number(element.getAttribute("aria-level") ?? (/^h[1-6]$/.test(tag) ? tag.slice(1) : "0")) : 0;
        return [{ role, name, ...(role === "dialog" ? { modal: true as const, open: true } : {}), ...(level > 0 ? { level } : {}) }];
      });
    });
  }

export async function collectForms(target: Target): Promise<Array<Record<string, unknown>>> {
    return target.evaluate(() => [...document.forms].map((form, index) => ({
      formId: form.id || `form-${index}`,
      fields: [...form.elements].flatMap((field, fieldIndex) => {
        if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement)) return [];
        const minLength = "minLength" in field && field.minLength >= 0 ? field.minLength : undefined;
        const maxLength = "maxLength" in field && field.maxLength >= 0 ? field.maxLength : undefined;
        const minimum = field instanceof HTMLInputElement && field.min !== "" && Number.isFinite(Number(field.min)) ? Number(field.min) : undefined;
        const maximum = field instanceof HTMLInputElement && field.max !== "" && Number.isFinite(Number(field.max)) ? Number(field.max) : undefined;
        const pattern = field instanceof HTMLInputElement && field.pattern ? field.pattern : undefined;
        const sensitive = /password|secret|token|credential|authorization|cookie|ssn|credit[ -]?card|api[ -_]?key|@/i;
        const options = field instanceof HTMLSelectElement
          ? [...field.options]
            .filter(option => !option.disabled && !option.hidden && !option.parentElement?.hasAttribute("hidden") && option.value.trim() !== "" && !sensitive.test(`${option.value} ${option.label}`))
            .map(option => option.value.trim())
            .filter((value, optionIndex, values) => values.indexOf(value) === optionIndex)
            .sort((left, right) => left.localeCompare(right))
          : undefined;
        return [{
          fieldId: field.id || field.getAttribute("data-testid") || field.getAttribute("name") || `field-${fieldIndex}`,
          name: field.getAttribute("name") || undefined,
          type: field.getAttribute("type") || field.tagName.toLowerCase(),
          required: field.required,
          disabled: field.disabled,
          ...(minLength !== undefined ? { minLength } : {}),
          ...(maxLength !== undefined ? { maxLength } : {}),
          ...(minimum !== undefined ? { minimum } : {}),
          ...(maximum !== undefined ? { maximum } : {}),
          ...(pattern ? { pattern } : {}),
          ...(options?.length ? { options } : {}),
        }];
      }),
    })));
  }
