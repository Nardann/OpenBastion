import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, BadRequestException } from '@nestjs/common';
import { parseCookies } from './common/utils/security';
import { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import { getCorsConfig } from './common/config/cors.config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { json, urlencoded } from 'express';

async function bootstrap() {
  // We disable the default body parser to configure it manually with limits
  // to avoid 'stream is not readable' issues when middleware are used.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });

  // SECURITY FIX: Trust proxy so req.ip returns the actual client IP
  app.set('trust proxy', 1);

  // Security Headers (HSTS, clickjacking, no-sniff, etc.)
  // SECURITY: nginx already emits a strict CSP for the public app — having
  // helmet send a different CSP at the same time leaves the browser with
  // two separate policies whose intersection is harder to reason about.
  // We disable helmet's CSP and keep the single nginx-emitted policy.
  // We also disable helmet's frameguard because nginx sets X-Frame-Options
  // to DENY (helmet would override to SAMEORIGIN).
  app.use(
    helmet({
      contentSecurityPolicy: false,
      frameguard: false,
    }),
  );

  // Enable CORS before body parsers. Cast: the upstream `cors` types model
  // the delegate's `req` as `any` while ours is typed; the runtime contract
  // is identical so we cast through `unknown` for a single line.
  app.enableCors(getCorsConfig() as unknown as Parameters<typeof app.enableCors>[0]);

  // SECURITY: enforce that mutating requests from the browser carry an
  // Origin header. The CORS layer already rejects disallowed origins; this
  // closes the gap for clients that simply omit Origin altogether (curl,
  // misconfigured proxies, server-side scripts) on POST/PATCH/PUT/DELETE.
  // SameSite=Strict cookies still mitigate browser CSRF; this just removes
  // the legacy "no Origin → bypass" code path on mutations.
  const ORIGIN_REQUIRED_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
  const ORIGIN_EXEMPT_PATHS = [
    /^\/api\/auth\/oidc\/callback/,        // server-to-server redirect from IdP
    /^\/auth\/oidc\/callback/,
    /^\/api\/health/,
    /^\/health/,
  ];
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!ORIGIN_REQUIRED_METHODS.has(req.method)) return next();
    if (ORIGIN_EXEMPT_PATHS.some((re) => re.test(req.url))) return next();
    const origin = req.headers['origin'];
    const referer = req.headers['referer'];
    if (!origin && !referer) {
      res.status(403).json({
        statusCode: 403,
        message: 'Origin or Referer header required for mutating requests',
        error: 'Forbidden',
      });
      return;
    }
    next();
  });

  // Configure body parsers WITH limits
  app.use(json({ limit: '50kb' }));
  app.use(urlencoded({ extended: true, limit: '50kb' }));

  // Internalized Cookie Parser Middleware
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).cookies = parseCookies(req.headers.cookie);
    next();
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
      exceptionFactory: (errors) => {
        // SECURITY FIX: Mask sensitive data in validation logs
        const sanitizedErrors = errors.map((error) => {
          const sanitizedTarget = { ...(error.target as any) };
          [
            'password',
            'privateKey',
            'currentPassword',
            'code',
            'tempToken',
            'clientSecret',
            'bindPassword',
            'refresh_token',
            'refreshToken',
          ].forEach((key) => {
            if (sanitizedTarget[key]) sanitizedTarget[key] = '***REDACTED***';
          });
          return { ...error, target: sanitizedTarget };
        });

        console.error(
          'Validation errors:',
          JSON.stringify(sanitizedErrors, null, 2),
        );
        const formattedErrors = errors.reduce(
          (acc, error) => {
            acc[error.property] = Object.values(error.constraints || {});
            return acc;
          },
          {} as Record<string, string[]>,
        );
        return new BadRequestException({
          message: 'Validation failed',
          errors: formattedErrors,
        });
      },
    }),
  );

  await app.listen(process.env['BACKEND_PORT'] || 3000);
}
bootstrap();
