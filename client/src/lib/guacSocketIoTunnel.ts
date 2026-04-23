import Guacamole from 'guacamole-common-js';
import type { Socket } from 'socket.io-client';

/**
 * A Guacamole.Tunnel implementation that transports the Guacamole protocol
 * over a Socket.IO channel instead of a raw WebSocket.
 *
 * The backend RdpGateway (namespace: /rdp) exposes three events:
 *   - `start-session` (client -> server) : opens the RDP connection
 *   - `data`                             : bidirectional raw protocol frames
 *   - `resize`         (client -> server) : triggers a guacd size instruction
 *   - `error` / `closed` / `ready`       : lifecycle signals
 *
 * We subclass Guacamole.Tunnel so Guacamole.Client can treat it like any
 * other tunnel (WebSocketTunnel, HTTPTunnel, ...).
 */
export interface StartSessionPayload {
  machineId: string;
  width: number;
  height: number;
}

export class SocketIoTunnel extends Guacamole.Tunnel {
  private parser = new Guacamole.Parser();
  private socket: Socket;
  private startPayload: StartSessionPayload;

  constructor(socket: Socket, startPayload: StartSessionPayload) {
    super();
    this.socket = socket;
    this.startPayload = startPayload;

    // Forward parsed instructions up to Guacamole.Client.
    this.parser.oninstruction = (opcode: string, args: string[]) => {
      if (this.oninstruction) this.oninstruction(opcode, args);
    };

    this.socket.on('data', (chunk: string) => {
      try {
        this.parser.receive(chunk);
      } catch (err) {
        this.fail('Protocol parse error');
      }
    });

    this.socket.on('ready', () => {
      this.setState(Guacamole.Tunnel.State.OPEN);
    });

    this.socket.on('error', (message: string) => {
      this.fail(message || 'Tunnel error');
    });

    this.socket.on('closed', () => {
      this.setState(Guacamole.Tunnel.State.CLOSED);
    });

    this.socket.on('disconnect', () => {
      this.setState(Guacamole.Tunnel.State.CLOSED);
    });
  }

  /** Called by Guacamole.Client on first connect. */
  connect(_data?: string): void {
    this.setState(Guacamole.Tunnel.State.CONNECTING);
    this.socket.emit('start-session', this.startPayload);
  }

  disconnect(): void {
    this.socket.disconnect();
    this.setState(Guacamole.Tunnel.State.CLOSED);
  }

  /**
   * Called by Guacamole.Client to emit input (mouse, keyboard, size, ...)
   * towards the remote RDP host.
   */
  sendMessage(...elements: unknown[]): void {
    // First element is opcode, rest are args. Encode using length.value syntax.
    const parts = elements.map((el) => {
      const s = String(el ?? '');
      return `${s.length}.${s}`;
    });
    const instr = parts.join(',') + ';';
    this.socket.emit('data', instr);
  }

  private fail(message: string) {
    if (this.onerror) {
      this.onerror(
        new Guacamole.Status(Guacamole.Status.Code.SERVER_ERROR, message),
      );
    }
    this.setState(Guacamole.Tunnel.State.CLOSED);
  }
}
