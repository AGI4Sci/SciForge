import { PlanGatewayRequestError } from './contract';

type PlanGatewayCredentialContext = Readonly<{
  adapterId: string;
  upstreamOrigin: string;
  incomingHeaders: Headers;
  signal: AbortSignal;
}>;

export interface PlanGatewayCredentialProvider {
  getBearerToken(context: PlanGatewayCredentialContext): Promise<string>;
}

export function assertBearerToken(value: string): string {
  if (!/^\S+$/.test(value)) {
    throw new PlanGatewayRequestError(
      502,
      'PLAN_CREDENTIAL_INVALID',
      'The credential provider returned an invalid bearer token.',
    );
  }
  return value;
}

export function createDelegatedCredentialProvider(): PlanGatewayCredentialProvider {
  return {
    async getBearerToken(context) {
      const authorization = context.incomingHeaders.get('authorization') ?? '';
      const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
      if (!match) {
        throw new PlanGatewayRequestError(
          401,
          'PLAN_AUTH_REQUIRED',
          'Coding-plan authentication must be supplied by the calling runtime.',
        );
      }
      return assertBearerToken(match[1]);
    },
  };
}
