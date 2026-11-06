/**
 * Launch policy for application-owned Python code, including signed resources.
 * Keep the caller's environment scope: never inherit or mutate process.env here.
 * -B is required because isolated Python (-I) ignores PYTHON* environment flags.
 * User-authored Python tools must keep their own launch policy.
 */
export function ownedPythonLaunch(
  args: readonly string[],
  environment: Readonly<Record<string, string | undefined>>
): { args: string[]; env: Record<string, string | undefined> } {
  return {
    args: ['-B', ...args],
    env: { ...environment, PYTHONDONTWRITEBYTECODE: '1' }
  }
}
