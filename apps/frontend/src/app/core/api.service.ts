import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

/** Thin typed wrapper so feature components stay terse. */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);

  get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    let hp = new HttpParams();
    for (const [k, v] of Object.entries(params ?? {})) {
      if (v !== undefined && v !== '') hp = hp.set(k, String(v));
    }
    return firstValueFrom(this.http.get<T>(`${environment.apiUrl}/${path}`, { params: hp }));
  }

  post<T>(path: string, body: unknown): Promise<T> {
    return firstValueFrom(this.http.post<T>(`${environment.apiUrl}/${path}`, body));
  }

  patch<T>(path: string, body: unknown): Promise<T> {
    return firstValueFrom(this.http.patch<T>(`${environment.apiUrl}/${path}`, body));
  }

  delete<T>(path: string): Promise<T> {
    return firstValueFrom(this.http.delete<T>(`${environment.apiUrl}/${path}`));
  }
}

/** Format integer minor units for display, e.g. 735 -> "7.35". */
export function fmtMinor(minor: number, decimals = 2): string {
  const neg = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  const factor = 10 ** decimals;
  const major = Math.floor(abs / factor);
  const frac = String(abs % factor).padStart(decimals, '0');
  return `${neg}${major}.${frac}`;
}

/** Parse a decimal string into integer minor units (e.g. "7.35" -> 735). */
export function parseMinor(value: string, decimals = 2): number {
  const n = Number.parseFloat(value || '0');
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10 ** decimals);
}

/** Format milli quantities: 1000 -> "1", 1250 -> "1.25". */
export function fmtMilli(qtyMilli: number): string {
  const v = qtyMilli / 1000;
  return Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

export function errMsg(e: unknown): string {
  const anyE = e as { error?: { message?: string | string[] }; message?: string };
  const m = anyE?.error?.message ?? anyE?.message ?? 'Unexpected error';
  return Array.isArray(m) ? m.join('; ') : String(m);
}
