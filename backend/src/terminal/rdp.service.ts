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
  recordingPath?: string | undefined;
  recordingName?: string | undefined;
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
      // guacd 1.5+ emits `args,VERSION_X_Y_Z,hostname,port,...` and expects
      // the client to echo the same protocol version as the FIRST element
      // of `connect`. Mismatching the version OR omitting it yields the
      // dreaded "Client did not return the expected number of arguments"
      // error on guacd's side. So we keep the version aside and prepend it
      // verbatim when we build the `connect` instruction.
      const [protocolVersion, ...argNames] = argsInstr.args;

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

      // 4. Send `connect` with the same VERSION_X_Y_Z prefix guacd sent us,
      //    followed by one value per advertised argName, in the same order.
      const values = argNames.map((name) => this.resolveArgValue(name, params));
      socket.write(
        encodeInstruction('connect', [protocolVersion ?? '', ...values]),
      );

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
      // Visual features: ENABLED by default. Disabling all of them is a
      // known way to get a Windows host to render a blank frame buffer
      // while waiting for input — counterintuitively, the safer default
      // is to let Windows draw its usual desktop. Bandwidth/latency
      // overhead is negligible inside a LAN bastion deployment.
      case 'enable-wallpaper':
        return 'true';
      case 'enable-theming':
        return 'true';
      case 'enable-desktop-composition':
        return 'true';
      case 'enable-font-smoothing':
        return 'true';
      case 'enable-full-window-drag':
        return 'true';
      case 'enable-menu-animations':
        return 'true';
      case 'disable-copy':
        return copyPasteDisabled;
      case 'disable-paste':
        return copyPasteDisabled;
      case 'disable-download':
        return 'true';
      case 'disable-upload':
        return 'true';
      case 'color-depth':
        return '32';
      case 'force-lossless':
        // Force PNG over JPEG. Without this, guacd alternates JPEG/PNG
        // depending on bandwidth heuristics and certain Windows hosts end
        // up sending a degraded initial frame.
        return 'true';
      case 'disable-bitmap-caching':
        // Disable the RDP bitmap cache. The cache can desync on first
        // connect, leaving the framebuffer in a half-painted state until
        // the user provokes a full refresh.
        return 'true';
      case 'disable-offscreen-caching':
        return 'true';
      case 'disable-glyph-caching':
        return 'true';
      case 'disable-gfx':
        // guacd 1.6 uses RDP Graphics Pipeline (GFX) by default with
        // FreeRDP 3, which encodes the framebuffer in surface instructions
        // that guacamole-common-js < 1.6 silently ignores — symptom:
        // cursor visible, framebuffer never paints. Apache hasn't published
        // common-js 1.6 to npm, so we stay on 1.5 and ask guacd to fall
        // back to the legacy bitmap pipeline.
        return 'true';
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
      case 'recording-path':
        return p.recordingPath ?? '';
      case 'recording-name':
        return p.recordingName ?? '';
      case 'recording-include-keys':
        // Keystroke logging disabled — we only keep the video recording.
        return '';
      default:
        return '';
    }
  }
}
