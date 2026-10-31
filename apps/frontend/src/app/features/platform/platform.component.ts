import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { ApiService, errMsg } from '../../core/api.service';

interface Tenant {
  tenantId: string;
  slug: string;
  name: string;
  industry: string;
  status: string;
  createdAt: string;
}

@Component({
  selector: 'app-platform',
  standalone: true,
  imports: [FormsModule, DatePipe],
  template: `
    <h1>Platform — Tenants</h1>
    @if (error()) {
      <p class="error-text">{{ error() }}</p>
    }
    @if (message()) {
      <p class="muted">{{ message() }}</p>
    }
    <div class="card">
      <table class="grid">
        <thead>
          <tr><th>Name</th><th>Slug</th><th>Industry</th><th>Status</th><th>Created</th><th></th></tr>
        </thead>
        <tbody>
          @for (t of tenants(); track t.tenantId) {
            <tr>
              <td>{{ t.name }}</td>
              <td>{{ t.slug }}</td>
              <td>{{ t.industry }}</td>
              <td>
                <span class="badge"
                  [class.badge-ok]="t.status === 'active'"
                  [class.badge-warn]="t.status === 'provisioning'"
                  [class.badge-danger]="t.status === 'suspended'">
                  {{ t.status }}
                </span>
              </td>
              <td>{{ t.createdAt | date: 'shortDate' }}</td>
              <td class="toolbar" style="margin: 0">
                @if (t.status === 'active') {
                  <button class="btn btn-sm btn-danger" (click)="suspend(t)">Suspend</button>
                }
                @if (t.status === 'suspended') {
                  <button class="btn btn-sm btn-primary" (click)="reactivate(t)">Reactivate</button>
                }
                @if (t.status === 'provisioning') {
                  <button class="btn btn-sm" (click)="retry(t)">Retry provisioning</button>
                }
              </td>
            </tr>
          } @empty {
            <tr><td colspan="6" class="muted">No tenants.</td></tr>
          }
        </tbody>
      </table>
    </div>
  `,
})
export class PlatformComponent implements OnInit {
  private readonly api = inject(ApiService);

  readonly tenants = signal<Tenant[]>([]);
  readonly error = signal('');
  readonly message = signal('');

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  async load(): Promise<void> {
    this.error.set('');
    try {
      const res = await this.api.get<Tenant[]>('platform/tenants');
      this.tenants.set(res);
    } catch (e) {
      this.error.set(errMsg(e));
    }
  }

  async suspend(t: Tenant): Promise<void> {
    if (!confirm(`Suspend ${t.name}? All API access and logins will be blocked.`)) return;
    await this.action(`platform/tenants/${t.tenantId}/suspend`, `Suspended ${t.slug}`);
  }

  async reactivate(t: Tenant): Promise<void> {
    await this.action(`platform/tenants/${t.tenantId}/reactivate`, `Reactivated ${t.slug}`);
  }

  async retry(t: Tenant): Promise<void> {
    await this.action(`platform/tenants/${t.tenantId}/retry-provisioning`, `Retried provisioning for ${t.slug}`);
  }

  private async action(path: string, okMessage: string): Promise<void> {
    this.message.set('');
    this.error.set('');
    try {
      await this.api.post(path, {});
      this.message.set(okMessage);
      await this.load();
    } catch (e) {
      this.error.set(errMsg(e));
    }
  }
}
