import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

export interface SessionInfo {
  scope: 'platform' | 'tenant';
  tenantId?: string;
  roles: string[];
  permissions: string[];
  email?: string;
  name?: string;
}

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; name: string; roles?: string[] };
}

const ACCESS_KEY = 'mizan.access';
const REFRESH_KEY = 'mizan.refresh';
const SLUG_KEY = 'mizan.slug';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  readonly session = signal<SessionInfo | null>(null);
  readonly isLoggedIn = computed(() => this.session() !== null);
  readonly isPlatform = computed(() => this.session()?.scope === 'platform');
  readonly permissions = computed(() => new Set(this.session()?.permissions ?? []));

  get accessToken(): string | null {
    return localStorage.getItem(ACCESS_KEY);
  }

  get tenantSlug(): string | null {
    return localStorage.getItem(SLUG_KEY);
  }

  hasPermission(p: string): boolean {
    return this.permissions().has(p);
  }

  async loginTenant(slug: string, email: string, password: string): Promise<void> {
    const res = await firstValueFrom(
      this.http.post<LoginResponse>(`${environment.apiUrl}/auth/login`, { tenantSlug: slug, email, password }),
    );
    localStorage.setItem(SLUG_KEY, slug);
    this.storeTokens(res);
    await this.loadMe();
  }

  async loginPlatform(email: string, password: string): Promise<void> {
    const res = await firstValueFrom(
      this.http.post<LoginResponse>(`${environment.apiUrl}/auth/platform/login`, { email, password }),
    );
    this.storeTokens(res);
    await this.loadMe();
  }

  /** Returns the new access token, or null if refresh failed. */
  async refresh(): Promise<string | null> {
    const refreshToken = localStorage.getItem(REFRESH_KEY);
    if (!refreshToken) return null;
    try {
      const res = await firstValueFrom(
        this.http.post<LoginResponse>(`${environment.apiUrl}/auth/refresh`, { refreshToken }),
      );
      this.storeTokens(res);
      return res.accessToken;
    } catch {
      this.clear();
      return null;
    }
  }

  async loadMe(): Promise<void> {
    if (!this.accessToken) return;
    try {
      const me = await firstValueFrom(this.http.get<SessionInfo>(`${environment.apiUrl}/auth/me`));
      this.session.set(me);
    } catch {
      // interceptor handles refresh; if we still fail, stay logged out
    }
  }

  async logout(): Promise<void> {
    const refreshToken = localStorage.getItem(REFRESH_KEY);
    if (refreshToken) {
      try {
        await firstValueFrom(this.http.post(`${environment.apiUrl}/auth/logout`, { refreshToken }));
      } catch {
        /* best effort */
      }
    }
    this.clear();
    void this.router.navigate(['/login']);
  }

  clear(): void {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
    this.session.set(null);
  }

  private storeTokens(res: LoginResponse): void {
    localStorage.setItem(ACCESS_KEY, res.accessToken);
    localStorage.setItem(REFRESH_KEY, res.refreshToken);
  }
}
