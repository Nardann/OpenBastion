import { Injectable, Logger } from '@nestjs/common';
import * as net from 'node:net';
import {
  encodeInstruction,
  GuacInstruction,
  GuacInstructionParser,
} from './guac-protocol';

/**
 * Parameters required to open an RDP session through guacd.
 * Values come from the Machine/Secret models (vault-decrypted) + user UI.
 */
export interface RdpConnectionParams {
  host: string;
  port: number;
  username: string;
  password?: string | undefined;
  domain?: string | undefined;
  security: 'any' | 'rdp' | 'tls' | 'nla';
  ignoreCert: boolean;
  width: number;
  height: number;
  dpi?: number | undefined;
  allowCopyPaste: boolean;
}

/**
 * Result of a successful handshake. The caller gets:
 *   - socket:   raw TCP socket to guacd, ready for bidirectional pipe
 *   - leftover: any bytes received from guacd AFTER the handshake that must
 *               be forwarded to the client first (edge case)
 */
export interface RdpStream {
  socket: net.Socket;
  leftover: string;
}

@Injectable()
export class RdpService {
  private readonly logger = new Logger(RdpService.name);
  private readonly guacdHost = process.env['GUACD_HOST'] || 'guacd';
  private readonly guacdPort = Number.parseInt(
    process.env['GUACD_PORT'] || '4822',
    10,
  );
  private readonly connectTimeoutMs = 15_000;
  private readonly handshakeTimeoutMs = 15_000;

  /**
   * Open a TCP connection to guacd, perform the full RDP handshake
   * (select / size / audio / video / image / connect), then hand back the
   * socket ready for raw byte forwarding between the browser and guacd.
   *
   * Credentials NEVER leave the backend: they are injected here and the
   * encrypted tunnel from the browser only ever sees post-handshake frames.
   */
  async createStream(params: RdpConnectionParams): Promise<RdpStream> {
    const socket = net.connect({ host: this.guacdHost, port: this.guacdPort });
    socket.setNoDelay(true);
    socket.setEncoding('utf8');

    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };
      const onTimeout = () => {
        cleanup();
        socket.destroy();
        reject(new Error('guacd connection timeout'));
      };
      const cleanup = () => {
        socket.off('connect', onConnect);
        socket.off('error', onError);
        socket.off('timeout', onTimeout);
      };
      const onConnect = () => {
        cleanup();
        resolve();
      };
      socket.setTimeout(this.connectTimeoutMs);
      socket.once('connect', onConnect);
      socket.once('error', onError);
      socket.once('timeout', onTimeout);
    });

    socket.setTimeout(0);

    try {
      const parser = new GuacInstructionParser();
      const pending: GuacInstruction[] = [];
      let onInstruction: ((i: GuacInstruction) => void) | null = null;
      let socketError: Error | null = null;

      const dataListener = (chunk: string) => {
        try {
          const parsed = parser.feed(chunk);
          for (const instr of parsed) {
            if (onInstruction) onInstruction(instr);
            else pending.push(instr);
          }
        } catch (err) {
          socketError = err as Error;
        }
      };
      const errorListener = (err: Error) => {
        socketError = err;
      };
      socket.on('data', dataListener);
      socket.on('error', errorListener);

      const nextInstr = (): Promise<GuacInstruction> =>
        new Promise((resolve, reject) => {
          if (socketError) return reject(socketError);
          const queued = pending.shift();
          if (queued) return resolve(queued);
          const timer = setTimeout(() => {
            onInstruction = null;
            reject(new Error('guacd handshake timeout'));
          }, this.handshakeTimeoutMs);
          onInstruction = (instr) => {
            clearTimeout(timer);
            onInstruction = null;
            resolve(instr);
          };
        });

      // 1. Request RDP protocol
      socket.write(encodeInstruction('select', ['rdp']));

      // 2. Read "args" instruction advertising the required parameters
      const argsInstr = await nextInstr();
      if (argsInstr.opcode !== 'args') {
        throw new Error(
          `Expected "args" instruction from guacd, got "${argsInstr.opcode}"`,
        );
      }
      // First arg is protocol version, rest are the named parameters guacd wants
      const [, ...argNames] = argsInstr.args;

      // 3. Client capabilities (server-side: we pose as the "client")
      socket.write(
        encodeInstruction('size', [
          String(params.width),
          String(params.height),
          String(params.dpi ?? 96),
        ]),
      );
      socket.write(encodeInstruction('audio', [])); // no audio formats accepted
      socket.write(encodeInstruction('video', [])); // no video formats
      socket.write(encodeInstruction('image', ['image/png', 'image/jpeg']));
      socket.write(encodeInstruction('timezone', ['UTC']));

      // 4. Send `connect` with values matching the advertised argNames
      const values = argNames.map((name) => this.resolveArgValue(name, params));
      socket.write(encodeInstruction('connect', values));

      // Remove listeners: the gateway will re-bind them for pipe mode.
      socket.off('data', dataListener);
      socket.off('error', errorListener);
      // Keep utf8 encoding for the rest of the session: the Guacamole wire
      // protocol is strictly UTF-8 safe (images are base64-encoded inside
      // `img` instructions), so we can pipe strings end-to-end without ever
      // dropping bytes. Anything left in `parser.leftover()` must be flushed
      // to the client first.
      const leftover = parser.leftover();

      this.logger.log(
        `guacd handshake OK host=${params.host}:${params.port} user=${params.username}`,
      );
      return { socket, leftover };
    } catch (err) {
      socket.destroy();
      throw err;
    }
  }

  /**
   * Map a guacd-advertised argument name to its value for this connection.
   * We only populate the parameters that matter for a secure RDP-only bastion.
   * Everything else defaults to empty string, which guacd treats as "not set".
   */
  private resolveArgValue(name: string, p: RdpConnectionParams): string {
    const copyPasteDisabled = p.allowCopyPaste ? 'false' : 'true';
    switch (name) {
      case 'hostname':
        return p.host;
      case 'port':
        return String(p.port);
      case 'username':
        return p.username;
      case 'password':
        return p.password ?? '';
      case 'domain':
        return p.domain ?? '';
      case 'security':
        return p.security;
      case 'ignore-cert':
        return p.ignoreCert ? 'true' : 'false';
      case 'disable-audio':
        return 'true';
      case 'enable-audio':
        return 'false';
      case 'enable-audio-input':
        return 'false';
      case 'enable-printing':
        return 'false';
      case 'enable-drive':
        return 'false';
      case 'enable-wallpaper':
        return 'false';
      case 'enable-theming':
        return 'false';
      case 'enable-desktop-composition':
        return 'false';
      case 'disable-copy':
        return copyPasteDisabled;
      case 'disable-paste':
        return copyPasteDisabled;
      case 'disable-download':
        return 'true';
      case 'disable-upload':
        return 'true';
      case 'color-depth':
        return '24';
      case 'width':
        return String(p.width);
      case 'height':
        return String(p.height);
      case 'dpi':
        return String(p.dpi ?? 96);
      case 'resize-method':
        return 'display-update';
      case 'client-name':
        return 'OpenBastion';
      case 'server-layout':
        return 'en-us-qwerty';
      default:
        return '';
    }
  }
}
