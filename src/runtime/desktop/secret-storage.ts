export type SecretScope = {
  service: string;
  account: string;
};

export interface SecretVault {
  getPassword(scope: SecretScope): Promise<string | undefined>;
  setPassword(scope: SecretScope, value: string): Promise<void>;
  deletePassword(scope: SecretScope): Promise<void>;
}

export type SecretStorageOptions = {
  vault?: SecretVault;
  allowPlaintextDebugFallback?: boolean;
  plaintextStore?: Map<string, string>;
};

export class DesktopSecretStorage {
  private readonly plaintextStore: Map<string, string>;

  constructor(private readonly options: SecretStorageOptions = {}) {
    this.plaintextStore = options.plaintextStore ?? new Map();
  }

  async read(scope: SecretScope): Promise<string | undefined> {
    if (this.options.vault) return this.options.vault.getPassword(scope);
    if (this.options.allowPlaintextDebugFallback === true) return this.plaintextStore.get(secretKey(scope));
    throw new Error('Secret storage unavailable: system credential vault is required unless plaintext debug fallback is explicitly enabled.');
  }

  async write(scope: SecretScope, value: string): Promise<void> {
    if (!value) throw new Error('Refusing to store an empty provider secret.');
    if (this.options.vault) {
      await this.options.vault.setPassword(scope, value);
      return;
    }
    if (this.options.allowPlaintextDebugFallback === true) {
      this.plaintextStore.set(secretKey(scope), value);
      return;
    }
    throw new Error('Secret storage unavailable: refusing plaintext provider secret without explicit debug fallback.');
  }

  async delete(scope: SecretScope): Promise<void> {
    if (this.options.vault) {
      await this.options.vault.deletePassword(scope);
      return;
    }
    if (this.options.allowPlaintextDebugFallback === true) {
      this.plaintextStore.delete(secretKey(scope));
      return;
    }
    throw new Error('Secret storage unavailable: system credential vault is required unless plaintext debug fallback is explicitly enabled.');
  }
}

export class MockSecretVault implements SecretVault {
  readonly values = new Map<string, string>();
  failWith?: Error;

  async getPassword(scope: SecretScope): Promise<string | undefined> {
    this.throwIfFailed();
    return this.values.get(secretKey(scope));
  }

  async setPassword(scope: SecretScope, value: string): Promise<void> {
    this.throwIfFailed();
    this.values.set(secretKey(scope), value);
  }

  async deletePassword(scope: SecretScope): Promise<void> {
    this.throwIfFailed();
    this.values.delete(secretKey(scope));
  }

  private throwIfFailed(): void {
    if (this.failWith) throw this.failWith;
  }
}

function secretKey(scope: SecretScope): string {
  return `${scope.service}:${scope.account}`;
}
