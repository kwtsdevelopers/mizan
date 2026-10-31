import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!auth.accessToken) return router.createUrlTree(['/login']);
  if (!auth.session()) await auth.loadMe();
  return auth.session() ? true : router.createUrlTree(['/login']);
};

export const platformGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.isPlatform() ? true : router.createUrlTree(['/']);
};
