// Complete type declaration for guacamole-common-js v1.5.x
// Replaces the broken @types/guacamole-common-js package.
declare module 'guacamole-common-js' {
  namespace Guacamole {
    class Tunnel {
      oninstruction: ((opcode: string, args: string[]) => void) | null;
      onerror: ((status: Status) => void) | null;
      setState(state: Tunnel.State): void;
      connect(data?: string): void;
      disconnect(): void;
      sendMessage(...elements: unknown[]): void;
    }
    namespace Tunnel {
      enum State {
        CONNECTING = 0,
        OPEN = 1,
        CLOSED = 2,
        UNSTABLE = 3,
      }
    }

    class Parser {
      oninstruction: ((opcode: string, args: string[]) => void) | null;
      receive(data: string): void;
    }

    class Client {
      constructor(tunnel: Tunnel);
      connect(data?: string): void;
      disconnect(): void;
      getDisplay(): Display;
      sendMouseState(state: Mouse.State): void;
      sendKeyEvent(pressed: 0 | 1, keysym: number): void;
      onstatechange: ((state: number) => void) | null;
      onerror: ((status: Status) => void) | null;
    }

    class Display {
      getElement(): HTMLElement;
    }

    class Status {
      constructor(code: number, message?: string);
      message: string;
      code: number;
      static Code: {
        SERVER_ERROR: number;
        [key: string]: number;
      };
    }

    class Mouse {
      constructor(element: HTMLElement);
      onmousedown: ((state: Mouse.State) => void) | null;
      onmouseup: ((state: Mouse.State) => void) | null;
      onmousemove: ((state: Mouse.State) => void) | null;
    }
    namespace Mouse {
      interface State {
        x: number;
        y: number;
        left: boolean;
        right: boolean;
        middle: boolean;
        up: boolean;
        down: boolean;
      }
    }

    class Keyboard {
      constructor(element: Document | HTMLElement);
      onkeydown: ((keysym: number) => void) | null;
      onkeyup: ((keysym: number) => void) | null;
    }
  }

  export = Guacamole;
}
