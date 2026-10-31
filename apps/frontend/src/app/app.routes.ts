import { Routes } from '@angular/router';
import { authGuard, platformGuard } from './core/auth.guard';

export const routes: Routes = [
  { path: 'login', loadComponent: () => import('./features/login/login.component').then((m) => m.LoginComponent) },
  {
    path: '',
    canActivate: [authGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'pos' },
      { path: 'pos', loadComponent: () => import('./features/pos/pos.component').then((m) => m.PosComponent) },
      { path: 'products', loadComponent: () => import('./features/products/products.component').then((m) => m.ProductsComponent) },
      { path: 'inventory', loadComponent: () => import('./features/inventory/inventory.component').then((m) => m.InventoryComponent) },
      { path: 'sales', loadComponent: () => import('./features/sales/sales.component').then((m) => m.SalesComponent) },
      { path: 'customers', loadComponent: () => import('./features/customers/customers.component').then((m) => m.CustomersComponent) },
      { path: 'suppliers', loadComponent: () => import('./features/suppliers/suppliers.component').then((m) => m.SuppliersComponent) },
      { path: 'purchasing', loadComponent: () => import('./features/purchasing/purchasing.component').then((m) => m.PurchasingComponent) },
      { path: 'reports', loadComponent: () => import('./features/reports/reports.component').then((m) => m.ReportsComponent) },
      { path: 'org', loadComponent: () => import('./features/org/org.component').then((m) => m.OrgComponent) },
      {
        path: 'platform',
        canActivate: [platformGuard],
        loadComponent: () => import('./features/platform/platform.component').then((m) => m.PlatformComponent),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
