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

  // Security Headers (CSP, HSTS, Clickjacking protection)
  app.use(helmet());

  // Enable CORS before body parsers
  app.enableCors(getCorsConfig());

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
          ['password', 'privateKey', 'currentPassword'].forEach((key) => {
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
