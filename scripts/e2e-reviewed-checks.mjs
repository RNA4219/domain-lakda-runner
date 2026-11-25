export function validCheck(check, review, actionIds) {
  if (!check || typeof check !== "object" || Array.isArray(check)) return false;
  const text = value => typeof value === "string" && value.trim().length > 0;
  const locator = loc => {
    if (!loc || typeof loc !== "object" || Array.isArray(loc)) return false;
    const keys = Object.keys(loc);
    if (keys.length === 1 && Object.hasOwn(loc, "testId")) return text(loc.testId);
    return keys.length === 2 && Object.hasOwn(loc, "role") && Object.hasOwn(loc, "name") &&
      ["button", "link", "textbox", "checkbox", "combobox", "option", "menuitem", "tab"].includes(loc.role) && text(loc.name);
  };
  const extended = ["amountEquals", "countEquals", "countDelta"].includes(check.kind);
  const intermediate = check.afterActionId !== undefined;
  const keys = check.kind === "url" ? ["kind", "value"] :
    check.kind === "visible" ? ["kind", "locator"] :
    check.kind === "textEquals" ? ["kind", "locator", "value"] :
    check.kind === "amountEquals" ? ["kind", "locator", "currency", "format", "minorUnits", "acceptanceRef"] :
    ["countEquals", "countDelta"].includes(check.kind) ? ["kind", "locator", "itemLocator", "value", "acceptanceRef"] : null;
  if (!keys) return false;
  if (intermediate) keys.push("afterActionId");
  if (!extended && check.acceptanceRef !== undefined) keys.push("acceptanceRef");
  if (Object.keys(check).length !== keys.length || keys.some(key => !Object.hasOwn(check, key))) return false;
  if (intermediate && (!text(check.afterActionId) || !actionIds.has(check.afterActionId))) return false;
  if ((intermediate || extended || check.acceptanceRef !== undefined) && (!text(check.acceptanceRef) ||
      ![...(review.traceTo ?? []), ...(review.oracleRefs ?? [])].includes(check.acceptanceRef))) return false;
  if (check.kind === "url") return text(check.value);
  if (!locator(check.locator)) return false;
  if (check.kind === "visible") return true;
  if (check.kind === "textEquals") return text(check.value);
  if (check.kind === "amountEquals") return Number.isSafeInteger(check.minorUnits) &&
    ((check.currency === "JPY" && check.format === "jpy-yen-suffix") ||
     (check.currency === "USD" && check.format === "usd-dollar-prefix"));
  return locator(check.itemLocator) && Number.isSafeInteger(check.value) &&
    (check.kind !== "countEquals" || check.value >= 0) && (check.kind !== "countDelta" || intermediate);
}


export function extendedCheck(value) {
  return !!value && (['amountEquals', 'countEquals', 'countDelta'].includes(value.kind) ||
    value.afterActionId !== undefined || value.acceptanceRef !== undefined ||
    ['amountEquals', 'countEquals', 'countDelta'].some(kind => Object.hasOwn(value, kind)));
}

export function toObligation(item) {
  const { kind, afterActionId, acceptanceRef, ...data } = item;
  let result;
  if (kind === 'url') result = { expectedUrl: data.value };
  else if (kind === 'visible') result = { visible: data.locator };
  else if (kind === 'textEquals') result = { textEquals: { locator: data.locator, text: data.value } };
  else result = { [kind]: data };
  if (afterActionId !== undefined) result.afterActionId = afterActionId;
  if (acceptanceRef !== undefined) result.acceptanceRef = acceptanceRef;
  return result;
}
