import { AppLedgerData } from '../types';

export interface LedgerStateResponse {
  hasData: boolean;
  data: unknown;
  revision: number;
  updatedAt: string | null;
}

interface RequestOptions extends RequestInit {
  json?: unknown;
}

const request = async <T>(path: string, options: RequestOptions = {}) => {
  const { json, headers, ...rest } = options;
  const response = await fetch(path, {
    credentials: 'include',
    headers: {
      ...(json === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    body: json === undefined ? rest.body : JSON.stringify(json),
    ...rest,
  });

  if (!response.ok) {
    let message = response.statusText;
    let currentRevision: number | undefined;
    try {
      const parsed = (await response.json()) as {
        error?: string;
        currentRevision?: number;
      };
      message = parsed.error ?? message;
      currentRevision = parsed.currentRevision;
    } catch {
      // Keep the HTTP status text.
    }
    const error = new Error(message);
    Object.assign(error, {
      status: response.status,
      currentRevision,
    });
    throw error;
  }

  return (await response.json()) as T;
};

export const api = {
  getSession: () =>
    request<{ authenticated: boolean }>('/api/auth/session'),

  login: (username: string, password: string) =>
    request<{ authenticated: boolean }>('/api/auth/login', {
      method: 'POST',
      json: { username, password },
    }),

  logout: () =>
    request<{ authenticated: boolean }>('/api/auth/logout', {
      method: 'POST',
    }),

  getLedger: () => request<LedgerStateResponse>('/api/ledger'),

  saveLedger: (data: AppLedgerData, revision: number) =>
    request<LedgerStateResponse>('/api/ledger', {
      method: 'PUT',
      json: { data, revision },
    }),

  importLedger: (data: AppLedgerData, revision: number, requireEmpty: boolean) =>
    request<LedgerStateResponse>('/api/ledger/import', {
      method: 'POST',
      json: { data, revision, requireEmpty },
    }),
};
