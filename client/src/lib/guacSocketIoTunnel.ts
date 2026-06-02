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
 * IMPORTANT: `Guacamole.Tunnel` is a legacy function-constructor that assigns
 * `connect`, `disconnect`, `sendMessage` as OWN PROPERTIES on `this` inside its
 * body. Subclassing with ES6 `class extends` would put our methods on the
 * prototype where the parent's own-property stubs shadow them at lookup time,
 * so the methods would never be called. We mirror the pattern used by the
 * built-in HTTPTunnel/WebSocketTunnel: assign the overrides on `this` from
 * within the constructor, after `super()`.
 */
export interface StartSessionPayload {
  machineId: string;
  width: number;
  height: number;
}

export class SocketIoTunnel extends Guacamole.Tunnel {
  constructor(socket: Socket, startPayload: StartSessionPayload) {
    super();

    const parser = new Guacamole.Parser();
    parser.oninstruction = (opcode: string, args: string[]) => {
      if (this.oninstruction) this.oninstruction(opcode, args);
    };

    const fail = (message: string) => {
      if (this.onerror) {
        this.onerror(
          new Guacamole.Status(Guacamole.Status.Code.SERVER_ERROR, message),
        );
      }
      this.setState(Guacamole.Tunnel.State.CLOSED);
    };

    socket.on('data', (chunk: string) => {
      try {
        parser.receive(chunk);
      } catch {
        fail('Protocol parse error');
      }
    });

    socket.on('ready', () => {
      this.setState(Guacamole.Tunnel.State.OPEN);
    });

    socket.on('error', (message: string) => {
      fail(message || 'Tunnel error');
    });

    socket.on('closed', () => {
      this.setState(Guacamole.Tunnel.State.CLOSED);
    });

    socket.on('disconnect', () => {
      this.setState(Guacamole.Tunnel.State.CLOSED);
    });

    // Override the parent's empty stubs on the instance — see class doc above.
    this.connect = (_data?: string): void => {
      this.setState(Guacamole.Tunnel.State.CONNECTING);
      socket.emit('start-session', startPayload);
    };

    this.disconnect = (): void => {
      socket.disconnect();
      this.setState(Guacamole.Tunnel.State.CLOSED);
    };

    this.sendMessage = (...elements: unknown[]): void => {
      const parts = elements.map((el) => {
        const s = String(el ?? '');
        return `${s.length}.${s}`;
      });
      const instr = parts.join(',') + ';';
      socket.emit('data', instr);
    };
  }
}
