import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuditService, AuditCategory } from '../../audit/audit.service';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(private auditService: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<{
      method: string;
      url: string;
      user: any;
      body: any;
      ip: string;
    }>();
    const { method, url, user, body, ip } = request;

    // Routes auditées explicitement dans leurs contrôleurs → skip l'intercepteur
    const EXPLICITLY_AUDITED = [
      '/auth/login',
      '/auth/logout',
      '/auth/oidc',
      '/auth/change-password',
      '/users',
      '/permissions',
    ];
    const isExplicitlyAudited = EXPLICITLY_AUDITED.some((route) => {
      const parsed = new URL(url, 'http://localhost');
      return (
        parsed.pathname === route || parsed.pathname.startsWith(route + '/')
      );
    });

    // L'intercepteur ne couvre que les mutations non déjà auditées
    const isMutation = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method);
    if (!isMutation || isExplicitlyAudited) {
      return next.handle();
    }

    // Log mutations that are not explicitly audited
    return next.handle().pipe(
      tap(() => {
        let category = AuditCategory.SYSTEM;
        if (url.includes('/auth')) category = AuditCategory.AUTH;
        else if (url.includes('/users')) category = AuditCategory.USER;
        else if (url.includes('/groups')) category = AuditCategory.GROUP;
        else if (url.includes('/machines')) category = AuditCategory.MACHINE;
        else if (url.includes('/permissions'))
          category = AuditCategory.PERMISSION;
        else if (url.includes('/terminal')) category = AuditCategory.TERMINAL;

        // LOW-05 FIX: Strip query parameters to avoid logging sensitive tokens/IDs
        const urlObj = new URL(url, 'http://localhost');
        const action = `${category}: ${method} ${urlObj.pathname}`;

        const userId = user?.sub || user?.id || null;
        const authMethod = user?.authMethod || null;

        // MED-04 FIX: Recursive sanitization function
        const sanitizeObject = (obj: any): any => {
          if (!obj || typeof obj !== 'object') return obj;
          if (Array.isArray(obj)) return obj.map(sanitizeObject);

          const SENSITIVE_FIELDS = [
            'password',
            'currentPassword',
            'passwordHash',
            'privateKey',
            'token',
            'secret',
            'clientSecret',
            'bindPassword',
            'bindCredentials',
          ];
          return Object.fromEntries(
            Object.entries(obj).map(([k, v]) => [
              k,
              SENSITIVE_FIELDS.includes(k)
                ? '***REDACTED***'
                : sanitizeObject(v),
            ]),
          );
        };

        const sanitizedBody = ['POST', 'PATCH', 'PUT'].includes(method)
          ? sanitizeObject(body)
          : null;

        this.auditService
          .logAction(userId, action, sanitizedBody, authMethod, ip, category)
          .catch((err) => {
            this.logger.error('Failed to save audit log:', err);
          });
      }),
    );
  }
}
