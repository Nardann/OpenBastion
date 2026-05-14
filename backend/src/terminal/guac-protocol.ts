/**
 * Minimal implementation of the Apache Guacamole protocol on the wire.
 *
 * Instruction syntax: "L.V,L.V,...;"
 *   - L is the length of V in UTF-16 code units
 *   - ',' separates args within an instruction
 *   - ';' ends an instruction
 *
 * We only need this for the backend-side handshake with guacd. After the
 * handshake completes we switch to raw byte forwarding and never parse again.
 *
 * Spec reference:
 *   https://guacamole.apache.org/doc/gug/protocol-reference.html
 */

export interface GuacInstruction {
  opcode: string;
  args: string[];
}

/** Encode one instruction ready to be written on the wire. */
export function encodeInstruction(opcode: string, args: string[] = []): string {
  const parts = [opcode, ...args].map((v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return `${s.length}.${s}`;
  });
  return parts.join(',') + ';';
}

/**
 * Streaming instruction parser. Feed it chunks, it yields complete
 * instructions. Unconsumed trailing bytes are retained in the internal
 * buffer (accessible via `leftover()`).
 */
export class GuacInstructionParser {
  private buffer = '';

  feed(chunk: string): GuacInstruction[] {
    this.buffer += chunk;
    const out: GuacInstruction[] = [];
    while (true) {
      const instr = this.tryParseOne();
      if (!instr) break;
      out.push(instr);
    }
    return out;
  }

  /** Current unparsed buffer (for flushing when switching to pipe mode). */
  leftover(): string {
    return this.buffer;
  }

  /** Reset internal state. */
  reset(): void {
    this.buffer = '';
  }

  private tryParseOne(): GuacInstruction | null {
    const args: string[] = [];
    let pos = 0;
    while (pos < this.buffer.length) {
      const dot = this.buffer.indexOf('.', pos);
      if (dot < 0) return null; // incomplete length prefix
      const lenStr = this.buffer.slice(pos, dot);
      const len = Number.parseInt(lenStr, 10);
      if (!Number.isFinite(len) || len < 0) {
        throw new Error(`Invalid length prefix in Guacamole stream: ${lenStr}`);
      }
      const valStart = dot + 1;
      const valEnd = valStart + len;
      if (valEnd >= this.buffer.length) return null; // value not fully buffered
      const value = this.buffer.slice(valStart, valEnd);
      args.push(value);
      const sep = this.buffer[valEnd];
      pos = valEnd + 1;
      if (sep === ';') {
        this.buffer = this.buffer.slice(pos);
        return { opcode: args[0] ?? '', args: args.slice(1) };
      }
      if (sep !== ',') {
        throw new Error(
          `Invalid separator '${sep}' in Guacamole stream at pos ${valEnd}`,
        );
      }
    }
    return null;
  }
}
