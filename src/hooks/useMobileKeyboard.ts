import { useEffect, useRef, useState } from 'react';

const KEYBOARD_HEIGHT_DELTA_PX = 120;
const MOBILE_BREAKPOINT_PX = 1024;

const NON_TEXT_INPUT_TYPES = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

export interface EditableElementLike {
  tagName?: string;
  type?: string;
  readOnly?: boolean;
  disabled?: boolean;
  isContentEditable?: boolean;
  getAttribute?: (name: string) => string | null;
}

export function isEditableElement(el: EditableElementLike | null | undefined): boolean {
  if (!el) return false;
  if (el.disabled || el.readOnly) return false;
  const tag = (el.tagName || '').toUpperCase();
  if (tag === 'TEXTAREA') return true;
  if (tag === 'INPUT') {
    const inputType = (el.type || 'text').toLowerCase();
    return !NON_TEXT_INPUT_TYPES.has(inputType);
  }
  if (el.isContentEditable) return true;
  const contentEditable = el.getAttribute?.('contenteditable');
  return contentEditable === '' || contentEditable === 'true';
}

export interface MobileKeyboardEvalInput {
  viewportWidth: number;
  visibleHeight: number;
  layoutHeight: number;
  prevBaselineHeight: number;
  prevWidth: number;
  editableFocused: boolean;
}

export interface MobileKeyboardEvalResult {
  keyboardOpen: boolean;
  viewportHeight: number | null;
  nextBaselineHeight: number;
  nextWidth: number;
}

export function computeMobileKeyboardState(
  input: MobileKeyboardEvalInput,
): MobileKeyboardEvalResult {
  const {
    viewportWidth,
    visibleHeight,
    layoutHeight,
    prevBaselineHeight,
    prevWidth,
    editableFocused,
  } = input;

  if (viewportWidth >= MOBILE_BREAKPOINT_PX) {
    return {
      keyboardOpen: false,
      viewportHeight: null,
      nextBaselineHeight: Math.max(visibleHeight, layoutHeight),
      nextWidth: viewportWidth,
    };
  }

  // Orientation change or major width resize: re-anchor baseline height
  const widthChanged = prevWidth > 0 && Math.abs(viewportWidth - prevWidth) > 40;
  const candidateFull = Math.max(visibleHeight, layoutHeight);
  const nextBaselineHeight = widthChanged
    ? candidateFull
    : Math.max(prevBaselineHeight, candidateFull);

  const heightDelta = nextBaselineHeight - visibleHeight;
  const keyboardOpen = editableFocused && heightDelta >= KEYBOARD_HEIGHT_DELTA_PX;

  return {
    keyboardOpen,
    viewportHeight: keyboardOpen ? Math.max(200, Math.round(visibleHeight)) : null,
    nextBaselineHeight,
    nextWidth: viewportWidth,
  };
}

export interface MobileKeyboardState {
  keyboardOpen: boolean;
  viewportHeight: number | null;
}

export function useMobileKeyboard(): MobileKeyboardState {
  const [state, setState] = useState<MobileKeyboardState>({
    keyboardOpen: false,
    viewportHeight: null,
  });

  const baselineHeightRef = useRef<number>(
    typeof window !== 'undefined'
      ? Math.max(window.visualViewport?.height ?? 0, window.innerHeight || 0)
      : 0,
  );
  const prevWidthRef = useRef<number>(
    typeof window !== 'undefined' ? window.innerWidth || 0 : 0,
  );

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const evaluate = () => {
      const vv = window.visualViewport;
      const viewportWidth = vv?.width ?? window.innerWidth;
      const visibleHeight = vv?.height ?? window.innerHeight;
      const layoutHeight = window.innerHeight;
      const activeEl = document.activeElement as EditableElementLike | null;
      const editableFocused = isEditableElement(activeEl);

      const next = computeMobileKeyboardState({
        viewportWidth,
        visibleHeight,
        layoutHeight,
        prevBaselineHeight: baselineHeightRef.current,
        prevWidth: prevWidthRef.current,
        editableFocused,
      });

      baselineHeightRef.current = next.nextBaselineHeight;
      prevWidthRef.current = next.nextWidth;

      setState((prev) =>
        prev.keyboardOpen === next.keyboardOpen && prev.viewportHeight === next.viewportHeight
          ? prev
          : { keyboardOpen: next.keyboardOpen, viewportHeight: next.viewportHeight },
      );
    };

    const handleFocusChange = () => {
      // Allow a frame for visualViewport/layout resize on focusin/focusout
      window.requestAnimationFrame(evaluate);
    };

    evaluate();
    const vv = window.visualViewport;
    vv?.addEventListener('resize', evaluate);
    vv?.addEventListener('scroll', evaluate);
    window.addEventListener('resize', evaluate);
    document.addEventListener('focusin', handleFocusChange);
    document.addEventListener('focusout', handleFocusChange);

    return () => {
      vv?.removeEventListener('resize', evaluate);
      vv?.removeEventListener('scroll', evaluate);
      window.removeEventListener('resize', evaluate);
      document.removeEventListener('focusin', handleFocusChange);
      document.removeEventListener('focusout', handleFocusChange);
    };
  }, []);

  return state;
}
