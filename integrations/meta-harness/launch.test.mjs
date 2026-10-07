import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './launch.mjs';

test('launcher uses argument arrays, hides the Windows helper, and preserves paths with spaces', () => {
  let observed;
  const child = { on() { return this; } };
  const returned = launch({ python: 'C:\\Python 3\\python.exe', home: 'C:\\My Company\\state',
    spawnProcess: (...args) => { observed = args; return child; } });
  assert.equal(returned, child);
  assert.deepEqual(observed[1], ['-m', 'meta_harness', '--home', 'C:\\My Company\\state', 'serve', '--port', '4317']);
  assert.equal(observed[2].shell, false);
  assert.equal(observed[2].windowsHide, true);
});

test('invalid ports do not spawn a process', () => {
  assert.throws(() => launch({port: -1}), /Invalid dashboard port/);
});
