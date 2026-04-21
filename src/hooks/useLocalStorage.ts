import {
  useCallback,
  useRef,
  useSyncExternalStore,
  type Dispatch,
  type SetStateAction,
} from "react";

const LOCAL_STORAGE_EVENT = "local-storage-change";

function readLocalStorageValue<T>(key: string, initialValue: T): T {
  if (typeof window === "undefined") {
    return initialValue;
  }

  try {
    const item = window.localStorage.getItem(key);
    return item === null ? initialValue : (JSON.parse(item) as T);
  } catch {
    return initialValue;
  }
}

export function useLocalStorage<T>(
  key: string,
  initialValue: T,
): readonly [T, Dispatch<SetStateAction<T>>] {
  const lastSnapshotRef = useRef<T>(initialValue);
  const lastRawValueRef = useRef<string | null>(null);

  const subscribe = useCallback(
    (onStoreChange: () => void): (() => void) => {
      if (typeof window === "undefined") {
        return () => undefined;
      }

      const handleChange = (event: Event): void => {
        if (event instanceof StorageEvent) {
          if (event.key !== key) {
            return;
          }
        } else if (
          event instanceof CustomEvent &&
          event.detail &&
          typeof event.detail === "object" &&
          "key" in event.detail &&
          event.detail.key !== key
        ) {
          return;
        }

        onStoreChange();
      };

      window.addEventListener("storage", handleChange);
      window.addEventListener(LOCAL_STORAGE_EVENT, handleChange);

      return () => {
        window.removeEventListener("storage", handleChange);
        window.removeEventListener(LOCAL_STORAGE_EVENT, handleChange);
      };
    },
    [key],
  );

  const getSnapshot = useCallback((): T => {
    if (typeof window === "undefined") {
      return initialValue;
    }

    try {
      const rawValue = window.localStorage.getItem(key);

      if (rawValue === null) {
        lastRawValueRef.current = null;
        lastSnapshotRef.current = initialValue;
        return initialValue;
      }

      if (rawValue !== lastRawValueRef.current) {
        lastRawValueRef.current = rawValue;
        lastSnapshotRef.current = JSON.parse(rawValue) as T;
      }

      return lastSnapshotRef.current;
    } catch {
      lastRawValueRef.current = null;
      lastSnapshotRef.current = initialValue;
      return initialValue;
    }
  }, [initialValue, key]);

  const storedValue = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => initialValue,
  );

  const setValue = useCallback<Dispatch<SetStateAction<T>>>(
    (value) => {
      if (typeof window === "undefined") {
        return;
      }

      const nextValue =
        value instanceof Function ? value(readLocalStorageValue(key, initialValue)) : value;

      try {
        window.localStorage.setItem(key, JSON.stringify(nextValue));
        window.dispatchEvent(
          new CustomEvent(LOCAL_STORAGE_EVENT, { detail: { key } }),
        );
      } catch {
        // Ignore storage write failures so the UI stays responsive.
      }
    },
    [initialValue, key],
  );

  return [storedValue, setValue] as const;
}
