import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { errMsg } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="login-wrap">
      <div class="card login-card">
        <h1>Mizan</h1>
        <div class="toolbar">
          <button class="btn btn-sm" [class.btn-primary]="mode() === 'tenant'" (click)="mode.set('tenant')">Store login</button>
          <button class="btn btn-sm" [class.btn-primary]="mode() === 'platform'" (click)="mode.set('platform')">Platform admin</button>
        </div>
        <form (ngSubmit)="submit()">
          @if (mode() === 'tenant') {
            <label>Store ID (slug)</label>
            <input name="slug" [(ngModel)]="slug" required autocomplete="organization" placeholder="my-market" />
          }
          <label>Email</label>
          <input name="email" type="email" [(ngModel)]="email" required autocomplete="username" />
          <label>Password</label>
          <input name="password" type="password" [(ngModel)]="password" required autocomplete="current-password" />
          @if (error()) {
            <p class="error-text">{{ error() }}</p>
          }
          <button class="btn btn-primary login-btn" type="submit" [disabled]="busy()">
            {{ busy() ? 'Signing in…' : 'Sign in' }}
          </button>
        </form>
      </div>
    </div>
  `,
  styles: [
    `
      .login-wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; }
      .login-card { width: 360px; }
      .login-btn { width: 100%; margin-top: 16px; justify-content: center; }
    `,
  ],
})
export class LoginComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly mode = signal<'tenant' | 'platform'>('tenant');
  readonly busy = signal(false);
  readonly error = signal('');

  slug = this.auth.tenantSlug ?? '';
  email = '';
  password = '';

  async submit(): Promise<void> {
    this.error.set('');
    this.busy.set(true);
    try {
      if (this.mode() === 'tenant') {
        await this.auth.loginTenant(this.slug.trim(), this.email.trim(), this.password);
        await this.router.navigate(['/pos']);
      } else {
        await this.auth.loginPlatform(this.email.trim(), this.password);
        await this.router.navigate(['/platform']);
      }
    } catch (e) {
      this.error.set(errMsg(e));
    } finally {
      this.busy.set(false);
    }
  }
}
