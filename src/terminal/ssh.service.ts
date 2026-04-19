import { Injectable, Logger } from '@nestjs/common';
import { Client } from 'ssh2';
import * as crypto from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { safeCompare } from '../common/utils/security';

@Injectable()
export class SshService {
  private readonly logger = new Logger(SshService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Generates a standard OpenSSH SHA256 Base64 fingerprint (without padding)
   */
  private computeFingerprint(rawKey: Buffer): string {
    const hash = crypto.createHash('sha256').update(rawKey).digest('base64');
    // OpenSSH strips the base64 padding '='
    return `SHA256:${hash.replace(/=+$/, '')}`;
  }

  async getFingerprint(host: string, port: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const conn = new Client();
      let fingerprint: string | null = null;

      conn
        .on('error', (err) => {
          if (!fingerprint) reject(err);
        })
        .connect({
          host,
          port,
          username: 'probe',
          readyTimeout: 10000,
          // We DON'T set hostHash here to get the raw key in hostVerifier
          hostVerifier: (rawKey: Buffer) => {
            fingerprint = this.computeFingerprint(rawKey);
            conn.destroy();
            resolve(fingerprint);
            return true;
          },
        });
    });
  }

  async createStream(params: any): Promise<{ client: Client; stream: any }> {
    return new Promise((resolve, reject) => {
      const conn = new Client();

      conn
        .on('ready', () => {
          this.logger.log(`SSH connection ready for ${params.host}`);

          const shellOptions: any = { term: 'xterm-256color' };
          if (params.allowRebound === true && process.env['SSH_AUTH_SOCK']) {
            shellOptions.agentForward = true;
          }

          conn.shell(shellOptions, (err, stream) => {
            if (err) {
              conn.end();
              return reject(err);
            }
            resolve({ client: conn, stream });
          });
        })
        .on('error', (err) => {
          this.logger.error(`SSH connection error: ${err.message}`);
          reject(err);
        });

      // VULNERABILITY 5 FIX: Intercept X11 requests
      (conn as any).on(
        'x11',
        (_info: any, _accept: any, rejectRequest: any) => {
          this.logger.warn(
            `REJECTED X11 Forwarding request from ${params.host}`,
          );
          if (typeof rejectRequest === 'function') rejectRequest();
        },
      );

      // BLOCAGE DES TUNNELS (TCP Forwarding)
      (conn as any).on(
        'tcpip',
        (info: any, accept: any, rejectRequest: any) => {
          if (params.allowTunneling === false) {
            this.logger.warn(
              `REJECTED TCPIP Forwarding request to ${info.destIP}:${info.destPort}`,
            );
            if (typeof rejectRequest === 'function') rejectRequest();
            return;
          }
          if (typeof accept === 'function') accept();
        },
      );

      // BLOCAGE DES REQUÊTES GLOBALES DE FORWARDING
      (conn as any).on(
        'request',
        (accept: any, rejectRequest: any, name: string) => {
          if (name === 'tcpip-forward' || name === 'cancel-tcpip-forward') {
            if (params.allowTunneling === false) {
              this.logger.warn(`REJECTED global request: ${name}`);
              if (typeof rejectRequest === 'function') rejectRequest();
              return;
            }
          }
          if (typeof accept === 'function') accept();
        },
      );

      const connectConfig: any = {
        host: params.host,
        port: params.port || 22,
        username: params.username,
        password: params.password,
        privateKey: params.privateKey,
        readyTimeout: 20000,
        // We DON'T set hostHash to get the raw key
        hostVerifier: (
          rawKey: Buffer,
          callback: (isValid: boolean) => void,
        ) => {
          const fingerprint = this.computeFingerprint(rawKey);

          this.prisma.machine
            .findFirst({
              where: { ip: params.host, port: params.port || 22 },
            })
            .then((machine: any) => {
              if (!machine?.sshFingerprint) {
                this.logger.error(
                  `SECURITY: No stored fingerprint for ${params.host}. Connection REFUSED.`,
                );
                callback(false);
              } else {
                const isValid = safeCompare(
                  machine.sshFingerprint,
                  fingerprint,
                );
                if (!isValid) {
                  this.logger.error(
                    `MITM ATTACK DETECTED? Host key mismatch for ${params.host}!`,
                  );
                  this.logger.error(`Stored: ${machine.sshFingerprint}`);
                  this.logger.error(`Actual: ${fingerprint}`);
                }
                callback(isValid);
              }
            })
            .catch((err: Error) => {
              this.logger.error(
                `Database error during host verification: ${err.message}`,
              );
              callback(false);
            });
        },
      };

      if (params.allowRebound === true && process.env['SSH_AUTH_SOCK']) {
        connectConfig.agentForward = true;
      }

      conn.connect(connectConfig);
    });
  }
}
