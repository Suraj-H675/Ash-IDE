import { randomUUID } from 'node:crypto'
import { open, rm } from 'node:fs/promises'
import { renameFileWithWindowsRetryAsync } from '../../shared/windows-retry-file-operations'

export async function writeTextFileAtomically(
  target: string,
  contents: string,
  options?: { mode?: number }
): Promise<void> {
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`
  const file = await open(temporary, 'wx', options?.mode)
  try {
    try {
      await file.writeFile(contents, 'utf8')
    } finally {
      await file.close()
    }
    await renameFileWithWindowsRetryAsync(temporary, target)
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined)
  }
}
