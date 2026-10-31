import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, errMsg } from '../../core/api.service';

interface Supplier {
  _id: string;
  name: string;
  phone?: string;
  email?: string;
  status: 'active' | 'archived';
}

@Component({
  selector: 'app-suppliers',
  standalone: true,
  imports: [FormsModule],
  template: `
    <h1>Suppliers</h1>
    <div class="card">
      <div class="toolbar">
        <span class="spacer"></span>
        <button class="btn btn-primary" (click)="startNew()">New supplier</button>
      </div>
      @if (error()) {
        <p class="error-text">{{ error() }}</p>
      }
      <table class="grid">
        <thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>Status</th><th></th></tr></thead>
        <tbody>
          @for (s of suppliers(); track s._id) {
            <tr>
              <td>{{ s.name }}</td>
              <td>{{ s.phone }}</td>
              <td>{{ s.email }}</td>
              <td>
                <span class="badge" [class.badge-ok]="s.status === 'active'" [class.badge-muted]="s.status !== 'active'">
                  {{ s.status === 'active' ? 'Active' : 'Archived' }}
                </span>
              </td>
              <td><button class="btn btn-sm" (click)="edit(s)">Edit</button></td>
            </tr>
          } @empty {
            <tr><td colspan="5" class="muted">No suppliers.</td></tr>
          }
        </tbody>
      </table>
    </div>

    @if (form(); as f) {
      <div class="card">
        <h2>{{ f._id ? 'Edit supplier' : 'New supplier' }}</h2>
        <div class="row">
          <div><label>Name</label><input name="name" [(ngModel)]="f.name" /></div>
          <div><label>Phone</label><input name="phone" [(ngModel)]="f.phone" /></div>
          <div><label>Email</label><input name="email" [(ngModel)]="f.email" /></div>
          @if (f._id) {
            <div>
              <label>Status</label>
              <select name="status" [(ngModel)]="f.status">
                <option value="active">Active</option>
                <option value="archived">Archived</option>
              </select>
            </div>
          }
        </div>
        <div class="toolbar" style="margin-top: 12px">
          <button class="btn btn-primary" (click)="save()" [disabled]="busy()">Save</button>
          <button class="btn" (click)="form.set(null)">Cancel</button>
        </div>
      </div>
    }
  `,
})
export class SuppliersComponent implements OnInit {
  private readonly api = inject(ApiService);

  readonly suppliers = signal<Supplier[]>([]);
  readonly error = signal('');
  readonly busy = signal(false);
  readonly form = signal<{ _id?: string; name: string; phone: string; email: string; status: 'active' | 'archived' } | null>(null);

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  async load(): Promise<void> {
    this.error.set('');
    try {
      const res = await this.api.get<{ items: Supplier[] }>('suppliers', { pageSize: 100 });
      this.suppliers.set(res.items);
    } catch (e) {
      this.error.set(errMsg(e));
    }
  }

  startNew(): void {
    this.form.set({ name: '', phone: '', email: '', status: 'active' });
  }

  edit(s: Supplier): void {
    this.form.set({ _id: s._id, name: s.name, phone: s.phone ?? '', email: s.email ?? '', status: s.status });
  }

  async save(): Promise<void> {
    const f = this.form();
    if (!f) return;
    this.busy.set(true);
    this.error.set('');
    const body = {
      name: f.name.trim(),
      phone: f.phone.trim() || undefined,
      email: f.email.trim() || undefined,
      ...(f._id ? { status: f.status } : {}),
    };
    try {
      if (f._id) {
        await this.api.patch(`suppliers/${f._id}`, body);
      } else {
        await this.api.post('suppliers', body);
      }
      this.form.set(null);
      await this.load();
    } catch (e) {
      this.error.set(errMsg(e));
    } finally {
      this.busy.set(false);
    }
  }
}
