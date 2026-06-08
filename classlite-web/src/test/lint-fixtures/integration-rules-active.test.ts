/// <reference types="node" />
/**
 * AC5 integration-level sandbox test (per Murat's party-mode revision).
 *
 * Closes the "rule configured but not wired into the npm script" silent-skip
 * failure mode. The unit fixtures invoke the linter APIs directly, which
 * skips the actual `npm run lint:css` / `npm run lint` plumbing. This test
 * drops a bad-hex file into a real src/ path the project's lint scripts
 * scan, runs the actual scripts, asserts non-zero exit AND asserts the
 * specific rule name appears in the captured output — without the latter
 * check, an unrelated pre-existing lint warning would false-green the test.
 *
 * The sandbox files are ALWAYS deleted in `finally`, even on assertion
 * failure, so a flaky run never leaves stray bad-hex files in the tree.
 * The sandbox path pattern (`src/test/__sandbox-*`) is also in .gitignore
 * to guard against accidental commits if the test is SIGKILL'd between
 * writeFileSync and finally.
 */

import { execSync } from 'node:child_process'
import { unlinkSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(HERE, '../../../')

const SANDBOX_CSS = resolve(PROJECT_ROOT, 'src/test/__sandbox-bad-hex.css')
const SANDBOX_TSX = resolve(PROJECT_ROOT, 'src/test/__sandbox-bad-hex.tsx')

interface CommandResult {
  exitCode: number
  stdout: string
  stderr: string
}

function runCommand(cmd: string): CommandResult {
  try {
    const stdout = execSync(cmd, { cwd: PROJECT_ROOT, stdio: 'pipe' }).toString()
    return { exitCode: 0, stdout, stderr: '' }
  } catch (err) {
    const e = err as { status?: number; stdout?: Buffer; stderr?: Buffer }
    return {
      exitCode: typeof e.status === 'number' ? e.status : 1,
      stdout: e.stdout?.toString() ?? '',
      stderr: e.stderr?.toString() ?? '',
    }
  }
}

function withSandbox(path: string, body: string, fn: () => void): void {
  writeFileSync(path, body)
  try {
    fn()
  } finally {
    try {
      unlinkSync(path)
    } catch {
      // file already gone (e.g. test process was interrupted) — ignore.
    }
  }
}

describe('AC5 lint scripts integration (sandbox)', () => {
  test('npm run lint:css fails AND fires color-no-hex on a real bad-hex CSS file placed in src/', () => {
    withSandbox(SANDBOX_CSS, 'body { color: #1a1f2e; }\n', () => {
      const result = runCommand('npm run lint:css --silent')
      expect(result.exitCode, `lint:css should exit non-zero; stderr=${result.stderr}`).not.toBe(0)
      const combined = `${result.stdout}\n${result.stderr}`
      expect(combined, 'color-no-hex rule must surface in the lint output').toMatch(/color-no-hex/)
      expect(combined, 'sandbox file must be named in the diagnostics').toMatch(/__sandbox-bad-hex\.css/)
    })
  })

  test('npm run lint fails AND fires no-restricted-syntax on a real bad-hex TSX file placed in src/', () => {
    withSandbox(SANDBOX_TSX, "export const navy = '#1a1f2e'\n", () => {
      const result = runCommand('npm run lint --silent')
      expect(result.exitCode, `lint should exit non-zero; stderr=${result.stderr}`).not.toBe(0)
      const combined = `${result.stdout}\n${result.stderr}`
      expect(combined, 'no-restricted-syntax rule must surface in the lint output').toMatch(
        /no-restricted-syntax/,
      )
      expect(combined, 'sandbox file must be named in the diagnostics').toMatch(/__sandbox-bad-hex\.tsx/)
    })
  })
})
