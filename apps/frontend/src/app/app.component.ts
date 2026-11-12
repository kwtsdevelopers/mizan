import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth.service';
import { OfflineQueueService } from './core/offline-queue.service';

type NavPos = 'left' | 'top' | 'right';
const NAV_POS_KEY = 'mizan.nav.pos';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  readonly auth = inject(AuthService);
  readonly queue = inject(OfflineQueueService);
  private readonly router = inject(Router);

  readonly navPos = signal<NavPos>(loadNavPos());

  readonly tenantNav = [
    { path: '/pos', label: 'POS', icon: '🛒' },
    { path: '/products', label: 'Products', icon: '🏷️' },
    { path: '/inventory', label: 'Inventory', icon: '📦' },
    { path: '/sales', label: 'Sales', icon: '🧾' },
    { path: '/customers', label: 'Customers', icon: '👥' },
    { path: '/suppliers', label: 'Suppliers', icon: '🚚' },
    { path: '/purchasing', label: 'Purchasing', icon: '📥' },
    { path: '/reports', label: 'Reports', icon: '📊' },
    { path: '/org', label: 'Organization', icon: '🏢' },
  ];

  setNavPos(pos: NavPos): void {
    this.navPos.set(pos);
    localStorage.setItem(NAV_POS_KEY, pos);
  }

  isLoginRoute(): boolean {
    return this.router.url.startsWith('/login');
  }
}

function loadNavPos(): NavPos {
  const v = localStorage.getItem(NAV_POS_KEY);
  return v === 'top' || v === 'right' ? v : 'left';
}
