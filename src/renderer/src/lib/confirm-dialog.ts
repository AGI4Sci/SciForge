export async function confirmDialog(message: string, detail?: string): Promise<boolean> {
  if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
    return window.confirm(detail ? `${message}\n\n${detail}` : message)
  }
  return false
}
