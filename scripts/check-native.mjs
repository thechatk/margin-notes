import { mkdtemp, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const dir = await mkdtemp(path.join(tmpdir(), 'margin-native-check-'));
try {
  await copyFile('test/native-check.swift', path.join(dir, 'main.swift'));
  const binary = path.join(dir, 'check');
  const sources = ['desktop/AnnotationPanel.swift', 'desktop/ShiftGesture.swift', 'desktop/SelectionCapture.swift', 'desktop/AnnotationAttachment.swift', path.join(dir, 'main.swift')];
  execFileSync('/usr/bin/swiftc', ['-module-cache-path', path.join(dir, 'cache'), ...sources, '-o', binary], { stdio: 'inherit' });
  execFileSync(binary, [], { stdio: 'inherit' });
  await copyFile('desktop/MarginNotes.swift', path.join(dir, 'main.swift'));
  execFileSync('/usr/bin/swiftc', ['-typecheck', '-target', 'arm64-apple-macos14.2', '-module-cache-path', path.join(dir, 'cache'), ...sources], { stdio: 'inherit' });
  console.log('The complete native app typechecks without a signing certificate.');
} finally { await rm(dir, { recursive: true, force: true }); }
