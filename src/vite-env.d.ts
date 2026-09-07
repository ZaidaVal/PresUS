/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_CLIENT_ID: string;
  readonly VITE_ALLOWED_GOOGLE_EMAILS: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module 'jeep-sqlite/loader' {
  export function defineCustomElements(win: Window): Promise<void> | void;
  export function applyPolyfills(): Promise<void>;
}
