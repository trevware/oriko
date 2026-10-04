/**
 * Just enough of Obsidian for the grid to run in a plain browser page.
 *
 * The perf harness bundles the real renderer with `obsidian` aliased here, so
 * what it measures is the code and stylesheet that ship, not a copy of them.
 * Only what the wall reaches is provided: the DOM helpers Obsidian adds to
 * every element, `setIcon`, `Platform`, and the vault types `convert.ts`
 * imports. Media in the harness is always remote, so the vault is never read.
 */

interface ElInfo {
  cls?: string | string[];
  text?: string;
  attr?: Record<string, string | number | boolean | null>;
  title?: string;
  type?: string;
  value?: string;
  href?: string;
  prepend?: boolean;
}

function classesOf(cls: string | string[] | undefined): string[] {
  if (!cls) return [];
  return (Array.isArray(cls) ? cls : cls.split(" ")).filter(Boolean);
}

function build<K extends keyof HTMLElementTagNameMap>(
  parent: HTMLElement | null,
  tag: K,
  info?: ElInfo | string,
  callback?: (el: HTMLElementTagNameMap[K]) => void
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  const o: ElInfo = typeof info === "string" ? { cls: info } : info ?? {};
  for (const c of classesOf(o.cls)) el.classList.add(c);
  if (o.text !== undefined) el.textContent = o.text;
  if (o.title !== undefined) el.title = o.title;
  if (o.attr) {
    for (const [k, v] of Object.entries(o.attr)) {
      if (v === null || v === false) continue;
      el.setAttribute(k, v === true ? "" : String(v));
    }
  }
  if (o.type !== undefined) el.setAttribute("type", o.type);
  if (o.value !== undefined) (el as unknown as HTMLInputElement).value = o.value;
  if (o.href !== undefined) el.setAttribute("href", o.href);
  if (parent) {
    if (o.prepend) parent.prepend(el);
    else parent.appendChild(el);
  }
  callback?.(el);
  return el;
}

const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
const helpers: Record<string, unknown> = {
  createEl(this: HTMLElement, tag: keyof HTMLElementTagNameMap, info?: ElInfo | string, cb?: never) {
    return build(this, tag, info, cb);
  },
  createDiv(this: HTMLElement, info?: ElInfo | string, cb?: never) {
    return build(this, "div", info, cb);
  },
  createSpan(this: HTMLElement, info?: ElInfo | string, cb?: never) {
    return build(this, "span", info, cb);
  },
  addClass(this: HTMLElement, ...cls: string[]) {
    this.classList.add(...cls.flatMap((c) => classesOf(c)));
  },
  addClasses(this: HTMLElement, cls: string[]) {
    this.classList.add(...cls);
  },
  removeClass(this: HTMLElement, ...cls: string[]) {
    this.classList.remove(...cls.flatMap((c) => classesOf(c)));
  },
  removeClasses(this: HTMLElement, cls: string[]) {
    this.classList.remove(...cls);
  },
  toggleClass(this: HTMLElement, cls: string | string[], value: boolean) {
    for (const c of classesOf(cls)) this.classList.toggle(c, value);
  },
  hasClass(this: HTMLElement, cls: string) {
    return this.classList.contains(cls);
  },
  empty(this: HTMLElement) {
    while (this.firstChild) this.removeChild(this.firstChild);
  },
  setText(this: HTMLElement, text: string) {
    this.textContent = text;
  },
  setAttr(this: HTMLElement, name: string, value: string | number | boolean | null) {
    if (value === null) this.removeAttribute(name);
    else this.setAttribute(name, String(value));
  },
  setCssStyles(this: HTMLElement, styles: Partial<CSSStyleDeclaration>) {
    Object.assign(this.style, styles);
  },
  setCssProps(this: HTMLElement, props: Record<string, string>) {
    for (const [k, v] of Object.entries(props)) this.style.setProperty(k, v);
  },
  detach(this: HTMLElement) {
    this.remove();
  },
};
for (const [name, fn] of Object.entries(helpers)) {
  if (!(name in proto)) Object.defineProperty(proto, name, { value: fn, configurable: true, writable: true });
}

const docProto = Document.prototype as unknown as Record<string, unknown>;
if (!("createDiv" in docProto)) {
  docProto.createDiv = (info?: ElInfo | string) => build(null, "div", info);
}

/** A small square glyph, the size of a Lucide icon, so layout matches. */
export function setIcon(parent: HTMLElement, name: string): void {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", `svg-icon lucide-${name}`);
  const path = document.createElementNS(ns, "circle");
  path.setAttribute("cx", "12");
  path.setAttribute("cy", "12");
  path.setAttribute("r", "9");
  svg.appendChild(path);
  parent.appendChild(svg);
}

export const Platform = {
  isMobile: false,
  isMobileApp: false,
  isDesktop: true,
  isDesktopApp: true,
  isMacOS: true,
  isIosApp: false,
  isAndroidApp: false,
  isPhone: false,
  isTablet: false,
};

export class App {}
export class Vault {}
export class TFile {}
export class FileSystemAdapter {}

export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
}
