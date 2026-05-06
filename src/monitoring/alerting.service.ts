import { Injectable, Logger } from '@nestjs/common';

export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface AlertPayload {
  title: string;
  message: string;
  severity: AlertSeverity;
  metadata?: Record<string, unknown>;
  timestamp?: Date;
}

@Injectable()
export class AlertingService {
  private readonly logger = new Logger(AlertingService.name);

  private readonly slackWebhookUrl = process.env['ALERT_SLACK_WEBHOOK_URL'];
  private readonly genericWebhookUrl = process.env['ALERT_WEBHOOK_URL'];
  private readonly alertEmail = process.env['ALERT_EMAIL_TO'];
  private readonly smtpFrom = process.env['SMTP_FROM'];
  private readonly smtpHost = process.env['SMTP_HOST'];
  private readonly smtpPort = Number(process.env['SMTP_PORT'] || 587);
  private readonly smtpUser = process.env['SMTP_USER'];
  private readonly smtpPass = process.env['SMTP_PASS'];

  async alert(payload: AlertPayload): Promise<void> {
    const enriched = { ...payload, timestamp: payload.timestamp ?? new Date() };
    this.logger.warn(`[${enriched.severity.toUpperCase()}] ${enriched.title}: ${enriched.message}`);

    await Promise.allSettled([
      this.sendSlack(enriched),
      this.sendWebhook(enriched),
      this.sendEmail(enriched),
    ]);
  }

  private async sendSlack(p: AlertPayload & { timestamp: Date }): Promise<void> {
    if (!this.slackWebhookUrl) return;
    const color = p.severity === 'critical' ? '#d93025' : p.severity === 'warning' ? '#f4a100' : '#0f9d58';
    const body = {
      attachments: [{
        color,
        title: `[${p.severity.toUpperCase()}] ${p.title}`,
        text: p.message,
        footer: 'OpenBastion',
        ts: Math.floor(p.timestamp.getTime() / 1000),
        fields: p.metadata
          ? Object.entries(p.metadata).map(([k, v]) => ({ title: k, value: String(v), short: true }))
          : [],
      }],
    };
    try {
      await fetch(this.slackWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (e) {
      this.logger.error(`Slack alert failed: ${(e as Error).message}`);
    }
  }

  private async sendWebhook(p: AlertPayload & { timestamp: Date }): Promise<void> {
    if (!this.genericWebhookUrl) return;
    try {
      await fetch(this.genericWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(p),
      });
    } catch (e) {
      this.logger.error(`Webhook alert failed: ${(e as Error).message}`);
    }
  }

  private async sendEmail(p: AlertPayload & { timestamp: Date }): Promise<void> {
    if (!this.alertEmail || !this.smtpHost || !this.smtpFrom) return;
    try {
      const nodemailer = await import('nodemailer');
      const transporter = nodemailer.createTransport({
        host: this.smtpHost,
        port: this.smtpPort,
        secure: this.smtpPort === 465,
        auth: this.smtpUser ? { user: this.smtpUser, pass: this.smtpPass } : undefined,
      });
      await transporter.sendMail({
        from: this.smtpFrom,
        to: this.alertEmail,
        subject: `[OpenBastion ${p.severity.toUpperCase()}] ${p.title}`,
        text: `${p.message}\n\nTimestamp: ${p.timestamp.toISOString()}\n\n${p.metadata ? JSON.stringify(p.metadata, null, 2) : ''}`,
      });
    } catch (e) {
      this.logger.error(`Email alert failed: ${(e as Error).message}`);
    }
  }
}
