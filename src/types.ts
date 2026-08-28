// The contract the ExileCompass host provides to an addon panel, as published
// in `tools/addon-scaffold/create-addon.mjs`. Kept in step with that template;
// everything this addon actually needs landed in pluginApi 1.1 (app 1.5.0).

export type AddonGame = 'poe1' | 'poe2';

export interface AddonFetchResponse {
  status: number;
  body: string;
}

export interface AddonRequestOptions {
  url: string;
  /** `GET` (default) or `POST` — nothing else is permitted. */
  method?: 'GET' | 'POST';
  /** Only `Accept` and `Content-Type` may be set. The host owns the rest. */
  headers?: Record<string, string>;
  /** Up to 64 KB. */
  body?: string;
}

export interface AddonRequestResponse {
  status: number;
  /**
   * The subset the host lets through: `x-rate-limit-*`, `retry-after`, and
   * `content-type`. Names are lowercase.
   */
  headers: Record<string, string>;
  body: string;
}

export interface AddonHost {
  storage: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
  };
  net?: {
    fetch(url: string): Promise<AddonFetchResponse>;
    fetchImage?(url: string): Promise<string>;
    fetchCached?(url: string, maxAgeSeconds?: number): Promise<AddonFetchResponse>;
    request?(opts: AddonRequestOptions): Promise<AddonRequestResponse>;
  };
  shell?: {
    openExternal(url: string): Promise<void>;
  };
  game?: {
    get(): Promise<AddonGame>;
    onChange(cb: (game: AddonGame) => void): () => void;
  };
}

export interface PanelContext {
  root: HTMLElement;
  host: AddonHost;
}

export type MountFn = (ctx: PanelContext) => void | Promise<void>;
