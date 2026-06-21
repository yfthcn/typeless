// Ambient declarations for ts-check. TypeLess ships zero runtime deps;
// `TL` is a global injected by common.js into every context, so we type it
// loosely here rather than importing it. Browser APIs come from @types/chrome.
export {};

declare global {
  // The shared TypeLess namespace (common.js). Typed as `any` — its real
  // JSDoc types live in common.js and are checked there.
  // eslint-disable-next-line no-var
  var TL: any;
  // eslint-disable-next-line no-var
  var browser: any;

  interface Window {
    TL: any;
    browser: any;
    chrome: any;
    TLDebug?: any;
    __TL_CONTENT_LOADED__?: boolean;
  }
  interface WorkerGlobalScope {
    TL: any;
    browser: any;
    chrome: any;
    __TL_CONTENT_LOADED__?: boolean;
  }
}
