import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, errMsg } from '../../core/api.service';

interface Customer {
  _id: string;
  name: string;
  phone?: string;
  email?: string;
  notes?: string;
}

@Component({
  selector: 'app-customers',
  standalone: true,
  imports: [FormsModule],
  template: `
    <h1>Customers</h1>
    <div class="card">
      <div class="toolbar">
        <input name="search" [(ngModel)]="search" placeholder="Search customers" (keyup.enter)="load()" style="max-width: 320px" />
        <button class="btn" (click)="load()">Search</button>
        <span class="spacer"></span>
        <button class="btn btn-primary" (click)="startNew()">New customer</button>
      </div>
      @if (error()) {
        <p class="error-text">{{ error() }}</p>
      }
      <table class="grid">
        <thead><tr><th>Name</th><th>Phone</th><th>Email</th><th></th></tr></thead>
        <tbody>
          @for (c of customers(); track c._id) {
            <tr>
              <td>{{ c.name }}</td>
              <td>{{ c.phone }}</td>
              <td>{{ c.email }}</td>
              <td><button class="btn btn-sm" (click)="edit(c)">Edit</button></td>
            </tr>
          } @empty {
            <tr><td colspan="4" class="muted">No customers.</td></tr>
          }
        </tbody>
      </table>
    </div>

    @if (form(); as f) {
      <div class="card">
        <h2>{{ f._id ? 'Edit customer' : 'New customer' }}</h2>
        <div class="row">
          <div><label>Name</label><input name="name" [(ngModel)]="f.name" /></div>
          <div><label>Phone</label><input name="phone" [(ngModel)]="f.phone" /></div>
          <div><label>Email</label><input name="email" [(ngModel)]="f.email" /></div>
        </div>
        <label>Notes</label>
        <input name="notes" [(ngModel)]="f.notes" />
        <div class="toolbar" style="margin-top: 12px">
          <button class="btn btn-primary" (click)="save()" [disabled]="busy()">Save</button>
          <button class="btn" (click)="form.set(null)">Cancel</button>
        </div>
      </div>
    }
  `,
})
export class CustomersComponent implements OnInit {
  private readonly api = inject(ApiService);

  readonly customers = signal<Customer[]>([]);
  readonly error = signal('');
  readonly busy = signal(false);
  readonly form = signal<{ _id?: string; name: string; phone: string; email: string; notes: string } | null>(null);

  search = '';

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  async load(): Promise<void> {
    this.error.set('');
    try {
      const res = await this.api.get<{ items: Customer[] }>('customers', {
        search: this.search.trim() || undefined,
        pageSize: 100,
      });
      this.customers.set(res.items);
    } catch (e) {
      this.error.set(errMsg(e));
    }
  }

  startNew(): void {
    this.form.set({ name: '', phone: '', email: '', notes: '' });
  }

  edit(c: Customer): void {
    this.form.set({ _id: c._id, name: c.name, phone: c.phone ?? '', email: c.email ?? '', notes: c.notes ?? '' });
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
      notes: f.notes.trim() || undefined,
    };
    try {
      if (f._id) {
        await this.api.patch(`customers/${f._id}`, body);
      } else {
        await this.api.post('customers', body);
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
