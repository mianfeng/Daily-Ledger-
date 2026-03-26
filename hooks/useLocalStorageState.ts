import { useEffect, useState } from 'react';

type Deserialize<T> = (raw: string) => T;
type Serialize<T> = (value: T) => string;

interface LocalStorageStateOptions<T> {
  deserialize?: Deserialize<T>;
  serialize?: Serialize<T>;
}

const defaultDeserialize = <T,>(raw: string): T => JSON.parse(raw) as T;
const defaultSerialize = <T,>(value: T): string => JSON.stringify(value);

export const useLocalStorageState = <T>(
  key: string,
  initialValue: T | (() => T),
  options: LocalStorageStateOptions<T> = {},
) => {
  const deserialize = options.deserialize ?? defaultDeserialize<T>;
  const serialize = options.serialize ?? defaultSerialize<T>;

  const [state, setState] = useState<T>(() => {
    const fallback =
      typeof initialValue === 'function'
        ? (initialValue as () => T)()
        : initialValue;

    if (typeof window === 'undefined') {
      return fallback;
    }

    try {
      const saved = window.localStorage.getItem(key);
      return saved === null ? fallback : deserialize(saved);
    } catch {
      return fallback;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, serialize(state));
    } catch {
      // Ignore write failures and keep the UI responsive.
    }
  }, [key, serialize, state]);

  return [state, setState] as const;
};
