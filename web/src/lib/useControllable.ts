// Controlled / uncontrolled state in one hook (the Radix use-controllable-state pattern).
// Pass `prop` to let the parent own the value, or leave it undefined and the hook keeps its own.
import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseControllableParams<T> {
  /** The controlled value; undefined means uncontrolled. */
  prop?: T;
  /** Initial value when uncontrolled. */
  defaultProp: T;
  /** Called with every new value, in both modes. */
  onChange?: (value: T) => void;
}

export function useControllable<T>({ prop, defaultProp, onChange }: UseControllableParams<T>): [T, (next: T) => void] {
  const [inner, setInner] = useState<T>(defaultProp);
  const controlled = prop !== undefined;
  const value = controlled ? (prop as T) : inner;

  // Keep the latest callback and value without re-creating the setter.
  const onChangeRef = useRef(onChange);
  const valueRef = useRef(value);
  useEffect(() => {
    onChangeRef.current = onChange;
    valueRef.current = value;
  });

  const setValue = useCallback((next: T) => {
    if (Object.is(next, valueRef.current)) return;
    if (!controlled) setInner(next);
    onChangeRef.current?.(next);
  }, [controlled]);

  return [value, setValue];
}
