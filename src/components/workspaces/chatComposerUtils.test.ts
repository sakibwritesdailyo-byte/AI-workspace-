import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldSubmitComposerKey } from './chatComposerUtils';

test('shouldSubmitComposerKey submits on plain Enter and allows newline on Shift+Enter', () => {
  assert.equal(shouldSubmitComposerKey('Enter', false, false), true);
  assert.equal(shouldSubmitComposerKey('Enter', true, false), false);
  assert.equal(shouldSubmitComposerKey('a', false, false), false);
});

test('shouldSubmitComposerKey never submits while IME composition is active (e.g. Bangla/Android IME)', () => {
  assert.equal(shouldSubmitComposerKey('Enter', false, true), false);
  assert.equal(shouldSubmitComposerKey('Enter', true, true), false);
});
