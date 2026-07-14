import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { BioGymCliError, executeBioGymCli } from './biogym-cli-executor'

describe('executeBioGymCli', () => {
  it('preserves structured BioGym failure metadata from a non-zero CLI response', async () => {
    const failure = {
      status: 'error',
      message: 'SSH disconnected after the request was accepted.',
      code: 'remote_transport_error',
      outcome_unknown: true,
      request_id: 'req-structured-123'
    }

    const error = await executeBioGymCli(process.execPath, [
      '-e',
      `process.stdout.write(${JSON.stringify(JSON.stringify(failure))}); process.exit(1)`
    ], { cwd: tmpdir() }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(BioGymCliError)
    expect(error).toMatchObject({
      code: 'biogym_cli_failed',
      failure: {
        status: 'error',
        message: failure.message,
        code: 'remote_transport_error',
        outcomeUnknown: true,
        requestId: 'req-structured-123'
      },
      execution: { exitCode: 1 }
    })
  })

  it('preserves an indeterminate gateway code without classifying it as transport metadata', async () => {
    const failure = {
      status: 'error',
      message: 'The gateway could not establish the accepted mutation outcome.',
      code: 'indeterminate',
      request_id: 'req-indeterminate-456'
    }

    const error = await executeBioGymCli(process.execPath, [
      '-e',
      `process.stdout.write(${JSON.stringify(JSON.stringify(failure))}); process.exit(1)`
    ], { cwd: tmpdir() }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(BioGymCliError)
    expect(error).toMatchObject({
      code: 'biogym_cli_failed',
      failure: {
        code: 'indeterminate',
        requestId: 'req-indeterminate-456'
      }
    })
    expect((error as BioGymCliError).failure?.outcomeUnknown).toBeUndefined()
  })
})
