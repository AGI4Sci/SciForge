import { createHash, randomUUID } from 'node:crypto'
import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, posix, win32 } from 'node:path'

const HELPER_DIRECTORY_NAME = 'proxy-helper'
const HELPER_SOURCE_HASH_LENGTH = 16

export type Socks5ProxyEndpoint = Readonly<{
  host: '127.0.0.1' | '::1'
  port: number
}>

export type Socks5TargetEndpoint = Readonly<{
  host: string
  port: number
}>

export type Socks5ProxyHelperOptions = Readonly<{
  storageDirectory: string
  executablePath?: string
  platform?: NodeJS.Platform
}>

/**
 * Owns the tiny Node-compatible program used by OpenSSH ProxyCommand.
 *
 * Packaged Electron executables can run this CommonJS file when their inherited
 * environment contains ELECTRON_RUN_AS_NODE=1. The OpenSSH runner owns that
 * environment policy so the helper does not depend on a system Node or shell
 * utility.
 */
export class Socks5ProxyHelper {
  readonly helperPath: string
  private readonly executablePath: string
  private readonly platform: NodeJS.Platform
  private installation?: Promise<string>

  constructor(options: Socks5ProxyHelperOptions) {
    this.platform = options.platform ?? process.platform
    const path = this.platform === 'win32' ? win32 : posix
    if (!path.isAbsolute(options.storageDirectory)) {
      throw new Error('SOCKS5 proxy helper storage must be an absolute path.')
    }
    this.executablePath = options.executablePath ?? process.execPath
    if (!path.isAbsolute(this.executablePath)) {
      throw new Error('SOCKS5 proxy helper executable must be an absolute path.')
    }
    const sourceHash = createHash('sha256')
      .update(SOCKS5_PROXY_HELPER_SOURCE)
      .digest('hex')
      .slice(0, HELPER_SOURCE_HASH_LENGTH)
    this.helperPath = path.join(
      options.storageDirectory,
      HELPER_DIRECTORY_NAME,
      `socks5-proxy-${sourceHash}.cjs`
    )
  }

  ensureInstalled(): Promise<string> {
    this.installation ??= installHelper(this.helperPath)
    return this.installation
  }

  command(proxy: Socks5ProxyEndpoint, target: Socks5TargetEndpoint): string {
    requireProxyEndpoint(proxy)
    requireTargetEndpoint(target)
    const quote = this.platform === 'win32' ? quoteWindowsCommandArg : quotePosixCommandArg
    return [
      this.executablePath,
      this.helperPath,
      proxy.host,
      String(proxy.port),
      Buffer.from(target.host, 'utf8').toString('base64url'),
      String(target.port)
    ].map(quote).join(' ')
  }
}

async function installHelper(helperPath: string): Promise<string> {
  await mkdir(dirname(helperPath), { recursive: true, mode: 0o700 })
  try {
    const info = await lstat(helperPath)
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error('SOCKS5 proxy helper path is not a regular file.')
    }
    const source = await readFile(helperPath, 'utf8')
    if (source !== SOCKS5_PROXY_HELPER_SOURCE) {
      throw new Error('SOCKS5 proxy helper failed its integrity check.')
    }
    await chmod(helperPath, 0o600)
    return helperPath
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error
  }

  const temporaryPath = `${helperPath}.${randomUUID()}.tmp`
  try {
    await writeFile(temporaryPath, SOCKS5_PROXY_HELPER_SOURCE, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600
    })
    await rename(temporaryPath, helperPath)
  } catch (error) {
    if (errorCode(error) !== 'EEXIST' && errorCode(error) !== 'EPERM') throw error
    const source = await readFile(helperPath, 'utf8')
    if (source !== SOCKS5_PROXY_HELPER_SOURCE) {
      throw new Error('SOCKS5 proxy helper failed its integrity check.', { cause: error })
    }
  } finally {
    await rm(temporaryPath, { force: true })
  }
  return helperPath
}

function requireProxyEndpoint(endpoint: Socks5ProxyEndpoint): void {
  if (endpoint.host !== '127.0.0.1' && endpoint.host !== '::1') {
    throw new Error('SOCKS5 proxy helper only accepts a loopback proxy endpoint.')
  }
  requirePort(endpoint.port, 'proxy')
}

function requireTargetEndpoint(endpoint: Socks5TargetEndpoint): void {
  const bytes = Buffer.from(endpoint.host, 'utf8')
  if (
    hasControlOrWhitespace(endpoint.host) ||
    bytes.length < 1 ||
    bytes.length > 255 ||
    bytes.toString('utf8') !== endpoint.host
  ) {
    throw new Error('SOCKS5 target host must contain between 1 and 255 valid UTF-8 bytes.')
  }
  requirePort(endpoint.port, 'target')
}

function hasControlOrWhitespace(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)
    if (codePoint !== undefined && (codePoint <= 0x20 || codePoint === 0x7f)) return true
  }
  return false
}

function requirePort(port: number, label: 'proxy' | 'target'): void {
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`SOCKS5 ${label} port must be an integer between 1 and 65535.`)
  }
}

function quotePosixCommandArg(value: string): string {
  if (value.includes('\0')) throw new Error('ProxyCommand arguments cannot contain NUL bytes.')
  return `'${value.replaceAll("'", "'\"'\"'")}'`
}

function quoteWindowsCommandArg(value: string): string {
  if (value.includes('\0') || /[\r\n]/u.test(value)) {
    throw new Error('ProxyCommand arguments cannot contain NUL or newline bytes.')
  }
  // OpenSSH for Windows ultimately applies the standard CommandLineToArgvW
  // quoting rules. Escape backslashes only when they precede a quote or the
  // closing delimiter.
  return `"${value.replaceAll(/(\\*)"/gu, '$1$1\\"').replaceAll(/(\\+)$/gu, '$1$1')}"`
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined
}

/**
 * This is the canonical helper implementation. It is persisted verbatim rather
 * than compiled as a separate host entry, keeping ownership inside the domain
 * package and making installation independent of Electron's ASAR layout.
 */
export const SOCKS5_PROXY_HELPER_SOURCE = `'use strict';

const net = require('node:net');

function fail(message) {
  process.stderr.write('SciForge SOCKS5 proxy: ' + message + '\\n');
  process.exitCode = 1;
}

function parsePort(value, label) {
  if (!/^[0-9]{1,5}$/.test(value || '')) throw new Error(label + ' port is invalid');
  const port = Number(value);
  if (port < 1 || port > 65535) throw new Error(label + ' port is invalid');
  return port;
}

function decodeTargetHost(value) {
  if (!/^[A-Za-z0-9_-]{2,342}$/.test(value || '')) throw new Error('target host is invalid');
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.toString('base64url') !== value || bytes.length < 1 || bytes.length > 255) {
    throw new Error('target host is invalid');
  }
  const host = bytes.toString('utf8');
  if (!Buffer.from(host, 'utf8').equals(bytes) || host.includes('\\0')) {
    throw new Error('target host is invalid');
  }
  return host;
}

function encodeIpv6(value) {
  let halves = value.toLowerCase().split('::');
  if (halves.length > 2) throw new Error('target host is invalid');
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];

  function expandIpv4(parts) {
    if (parts.length === 0 || !parts[parts.length - 1].includes('.')) return parts;
    const octets = parts.pop().split('.').map(Number);
    if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
      throw new Error('target host is invalid');
    }
    parts.push(((octets[0] << 8) | octets[1]).toString(16));
    parts.push(((octets[2] << 8) | octets[3]).toString(16));
    return parts;
  }

  expandIpv4(left);
  expandIpv4(right);
  const omitted = 8 - left.length - right.length;
  if ((halves.length === 1 && omitted !== 0) || omitted < 0) throw new Error('target host is invalid');
  const words = halves.length === 2 ? left.concat(Array(omitted).fill('0'), right) : left;
  if (words.length !== 8) throw new Error('target host is invalid');
  const result = Buffer.alloc(16);
  words.forEach((word, index) => {
    if (!/^[0-9a-f]{1,4}$/.test(word)) throw new Error('target host is invalid');
    result.writeUInt16BE(Number.parseInt(word, 16), index * 2);
  });
  return result;
}

function encodeTarget(host, port) {
  const family = net.isIP(host);
  let address;
  let atyp;
  if (family === 4) {
    atyp = 1;
    address = Buffer.from(host.split('.').map(Number));
  } else if (family === 6) {
    atyp = 4;
    address = encodeIpv6(host);
  } else {
    address = Buffer.from(host, 'utf8');
    if (address.length < 1 || address.length > 255 || host.includes('\\0')) {
      throw new Error('target host is invalid');
    }
    atyp = 3;
    address = Buffer.concat([Buffer.from([address.length]), address]);
  }
  const encodedPort = Buffer.alloc(2);
  encodedPort.writeUInt16BE(port);
  return Buffer.concat([Buffer.from([5, 1, 0, atyp]), address, encodedPort]);
}

function bufferedReader(socket) {
  let buffered = Buffer.alloc(0);
  async function read(length) {
    while (buffered.length < length) {
      const chunk = await new Promise((resolve, reject) => {
        const onData = (value) => {
          cleanup();
          socket.pause();
          resolve(value);
        };
        const onError = (error) => {
          cleanup();
          reject(error);
        };
        const onEnd = () => {
          cleanup();
          reject(new Error('SOCKS5 proxy closed during handshake'));
        };
        const cleanup = () => {
          socket.off('data', onData);
          socket.off('error', onError);
          socket.off('end', onEnd);
        };
        socket.once('data', onData);
        socket.once('error', onError);
        socket.once('end', onEnd);
        socket.resume();
      });
      buffered = Buffer.concat([buffered, chunk]);
    }
    const result = buffered.subarray(0, length);
    buffered = buffered.subarray(length);
    return result;
  }
  return { read, take: () => { const value = buffered; buffered = Buffer.alloc(0); return value; } };
}

function write(socket, bytes) {
  return new Promise((resolve, reject) => {
    socket.write(bytes, (error) => error ? reject(error) : resolve());
  });
}

function connect(host, port) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const onError = (error) => {
      socket.off('connect', onConnect);
      reject(error);
    };
    const onConnect = () => {
      socket.off('error', onError);
      socket.pause();
      resolve(socket);
    };
    socket.once('error', onError);
    socket.once('connect', onConnect);
  });
}

async function main() {
  const [proxyHost, rawProxyPort, encodedTargetHost, rawTargetPort] = process.argv.slice(2);
  if (proxyHost !== '127.0.0.1' && proxyHost !== '::1') {
    throw new Error('proxy host must be loopback');
  }
  const proxyPort = parsePort(rawProxyPort, 'proxy');
  const targetPort = parsePort(rawTargetPort, 'target');
  const targetHost = decodeTargetHost(encodedTargetHost);
  const socket = await connect(proxyHost, proxyPort);
  const reader = bufferedReader(socket);

  try {
    await write(socket, Buffer.from([5, 1, 0]));
    const greeting = await reader.read(2);
    if (greeting[0] !== 5 || greeting[1] !== 0) {
      throw new Error('SOCKS5 proxy does not permit unauthenticated connections');
    }

    await write(socket, encodeTarget(targetHost, targetPort));
    const reply = await reader.read(4);
    if (reply[0] !== 5 || reply[1] !== 0 || reply[2] !== 0) {
      throw new Error('SOCKS5 CONNECT failed with status ' + reply[1]);
    }
    if (reply[3] === 1) await reader.read(4);
    else if (reply[3] === 4) await reader.read(16);
    else if (reply[3] === 3) {
      const length = (await reader.read(1))[0];
      await reader.read(length);
    } else {
      throw new Error('SOCKS5 proxy returned an invalid address type');
    }
    await reader.read(2);

    const pending = reader.take();
    if (pending.length > 0 && !process.stdout.write(pending)) {
      await new Promise((resolve) => process.stdout.once('drain', resolve));
    }
    socket.pipe(process.stdout, { end: false });
    process.stdin.pipe(socket);
    socket.resume();

    await new Promise((resolve, reject) => {
      socket.once('error', reject);
      socket.once('close', resolve);
    });
    process.stdin.unpipe(socket);
    process.stdin.pause();
  } finally {
    socket.destroy();
  }
}

main().catch((error) => fail(error && error.message ? error.message : String(error)));
`
