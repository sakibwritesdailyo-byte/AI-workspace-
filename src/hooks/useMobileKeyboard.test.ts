import test from 'node:test';
import assert from 'node:assert/strict';
import { computeMobileKeyboardState, isEditableElement } from './useMobileKeyboard';

test('isEditableElement recognizes enabled text inputs, textareas, and contenteditable only', () => {
  assert.equal(isEditableElement({ tagName: 'TEXTAREA' }), true);
  assert.equal(isEditableElement({ tagName: 'INPUT', type: 'text' }), true);
  assert.equal(isEditableElement({ tagName: 'INPUT', type: 'search' }), true);
  assert.equal(isEditableElement({ tagName: 'DIV', isContentEditable: true }), true);

  assert.equal(isEditableElement({ tagName: 'TEXTAREA', readOnly: true }), false);
  assert.equal(isEditableElement({ tagName: 'TEXTAREA', disabled: true }), false);
  assert.equal(isEditableElement({ tagName: 'INPUT', type: 'checkbox' }), false);
  assert.equal(isEditableElement({ tagName: 'INPUT', type: 'button' }), false);
  assert.equal(isEditableElement({ tagName: 'BUTTON' }), false);
  assert.equal(isEditableElement(null), false);
});

test('computeMobileKeyboardState detects keyboard open in both resizes-visual and resizes-content Android modes', () => {
  // Initial closed state on 390x844 phone
  const initial = computeMobileKeyboardState({
    viewportWidth: 390,
    visibleHeight: 844,
    layoutHeight: 844,
    prevBaselineHeight: 844,
    prevWidth: 390,
    editableFocused: false,
  });
  assert.equal(initial.keyboardOpen, false);
  assert.equal(initial.viewportHeight, null);

  // Android resizes-visual: layoutHeight stays 844 while visualViewport shrinks to 512
  const resizesVisual = computeMobileKeyboardState({
    viewportWidth: 390,
    visibleHeight: 512,
    layoutHeight: 844,
    prevBaselineHeight: initial.nextBaselineHeight,
    prevWidth: initial.nextWidth,
    editableFocused: true,
  });
  assert.equal(resizesVisual.keyboardOpen, true);
  assert.equal(resizesVisual.viewportHeight, 512);

  // Android resizes-content: BOTH layoutHeight and visualViewport shrink to 512
  const resizesContent = computeMobileKeyboardState({
    viewportWidth: 390,
    visibleHeight: 512,
    layoutHeight: 512,
    prevBaselineHeight: initial.nextBaselineHeight,
    prevWidth: initial.nextWidth,
    editableFocused: true,
  });
  assert.equal(resizesContent.keyboardOpen, true);
  assert.equal(resizesContent.viewportHeight, 512);

  // Keyboard closes when focus leaves editable control
  const blurred = computeMobileKeyboardState({
    viewportWidth: 390,
    visibleHeight: 844,
    layoutHeight: 844,
    prevBaselineHeight: resizesContent.nextBaselineHeight,
    prevWidth: resizesContent.nextWidth,
    editableFocused: false,
  });
  assert.equal(blurred.keyboardOpen, false);
  assert.equal(blurred.viewportHeight, null);
});

test('computeMobileKeyboardState handles orientation change and ignores desktop viewports', () => {
  // Landscape flip on phone (844x390) resets baseline rather than falsely marking keyboard open
  const landscape = computeMobileKeyboardState({
    viewportWidth: 844,
    visibleHeight: 390,
    layoutHeight: 390,
    prevBaselineHeight: 844,
    prevWidth: 390,
    editableFocused: true,
  });
  assert.equal(landscape.keyboardOpen, false);
  assert.equal(landscape.nextBaselineHeight, 390);

  // Desktop viewport (>= 1024px) never triggers mobile keyboard collapse
  const desktop = computeMobileKeyboardState({
    viewportWidth: 1440,
    visibleHeight: 600,
    layoutHeight: 600,
    prevBaselineHeight: 900,
    prevWidth: 1440,
    editableFocused: true,
  });
  assert.equal(desktop.keyboardOpen, false);
  assert.equal(desktop.viewportHeight, null);
});
