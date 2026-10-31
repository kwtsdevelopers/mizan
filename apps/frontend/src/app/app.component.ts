import { Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth.service';
import { OfflineQueueService } from './core/offline-queue.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    @if (auth.isLoggedIn() && !isLoginRoute()) {
      <div class="shell">
        <aside class="sidebar">
          <div class="brand">Mizan</div>
          @if (!auth.isPlatform()) {
            <nav>
              <a routerLink="/pos" routerLinkActive="active">POS</a>
              <a routerLink="/products" routerLinkActive="active">Products</a>
              <a routerLink="/inventory" routerLinkActive="active">Inventory</a>
              <a routerLink="/sales" routerLinkActive="active">Sales</a>
              <a routerLink="/customers" routerLinkActive="active">Customers</a>
              <a routerLink="/suppliers" routerLinkActive="active">Suppliers</a>
              <a routerLink="/purchasing" routerLinkActive="active">Purchasing</a>
              <a routerLink="/reports" routerLinkActive="active">Reports</a>
              <a routerLink="/org" routerLinkActive="active">Organization</a>
            </nav>
          } @else {
            <nav>
              <a routerLink="/platform" routerLinkActive="active">Tenants</a>
            </nav>
          }
          <div class="sidebar-footer">
            @if (!auth.isPlatform()) {
              <span class="badge" [class.badge-ok]="queue.online()" [class.badge-danger]="!queue.online()">
                {{ queue.online() ? 'Online' : 'Offline' }}
              </span>
              @if (queue.pendingCount() > 0) {
                <span class="badge badge-warn">{{ queue.pendingCount() }} pending</span>
              }
            }
            <button class="btn btn-sm" (click)="auth.logout()">Sign out</button>
          </div>
        </aside>
        <main class="content"><router-outlet /></main>
      </div>
    } @else {
      <router-outlet />
    }
  `,
  styles: [
    `
      .shell { display: flex; min-height: 100vh; }
      .sidebar {
        width: 200px; background: #122a22; color: #d6e5df; display: flex; flex-direction: column;
        padding: 16px 0; position: sticky; top: 0; height: 100vh;
      }
      .brand { font-size: 18px; font-weight: 700; color: #fff; padding: 0 16px 16px; }
      nav { display: flex; flex-direction: column; flex: 1; }
      nav a { color: #b9cdc5; padding: 9px 16px; border-left: 3px solid transparent; }
      nav a:hover { background: rgba(255, 255, 255, 0.06); color: #fff; }
      nav a.active { background: rgba(255, 255, 255, 0.1); color: #fff; border-left-color: #35b58d; }
      .sidebar-footer { padding: 12px 16px; display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
      .content { flex: 1; padding: 20px; max-width: 1200px; }
    `,
  ],
})
export class AppComponent {
  readonly auth = inject(AuthService);
  readonly queue = inject(OfflineQueueService);
  private readonly router = inject(Router);

  isLoginRoute(): boolean {
    return this.router.url.startsWith('/login');
  }
}
