import { WriteAssistService } from '@sciforge/write-assist/service'

let writeAssistService: WriteAssistService | null = null

export function getWriteAssistService(): WriteAssistService {
  writeAssistService ??= new WriteAssistService()
  return writeAssistService
}

export function resetWriteAssistService(): void {
  writeAssistService = null
}
