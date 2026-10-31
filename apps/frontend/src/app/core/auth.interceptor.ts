import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { AuthService } from './auth.service';

const AUTH_FREE = ['/auth/login', '/auth/platform/login', '/auth/refresh', '/plans', '/modules', '/tenants/register'];

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const token = auth.accessToken;
  const isAuthFree = AUTH_FREE.some((p) => req.url.includes(p));
  const authedReq =
    token && !isAuthFree ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;

  return next(authedReq).pipe(
    catchError((err: HttpErrorResponse) => {
      if (err.status === 401 && !isAuthFree && token) {
        return from(auth.refresh()).pipe(
          switchMap((newToken) => {
            if (!newToken) {
              void router.navigate(['/login']);
              return throwError(() => err);
            }
            return next(req.clone({ setHeaders: { Authorization: `Bearer ${newToken}` } }));
          }),
        );
      }
      return throwError(() => err);
    }),
  );
};
