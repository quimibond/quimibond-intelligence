import "@testing-library/jest-dom";

// jsdom doesn't implement IntersectionObserver, but several SP13 components
// (SectionNav scroll-spy, lazy-render hooks, etc.) reference it. Provide a
// minimal no-op stub so server-component pages render without throwing.
class StubIntersectionObserver implements IntersectionObserver {
  readonly root: Element | Document | null = null;
  readonly rootMargin: string = "";
  readonly thresholds: ReadonlyArray<number> = [];
  constructor(_cb: IntersectionObserverCallback, _opts?: IntersectionObserverInit) {}
  disconnect(): void {}
  observe(_target: Element): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
  unobserve(_target: Element): void {}
}
if (typeof globalThis.IntersectionObserver === "undefined") {
  // @ts-expect-error — jsdom polyfill for SP13 components
  globalThis.IntersectionObserver = StubIntersectionObserver;
}

// jsdom doesn't implement Element.scrollIntoView; SectionNav calls it on
// chip click. No-op so tests don't throw.
if (typeof (Element.prototype as Element & { scrollIntoView?: () => void }).scrollIntoView === "undefined") {
  Element.prototype.scrollIntoView = function () {};
}
