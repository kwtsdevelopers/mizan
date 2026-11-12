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
  templateUrl: './customers.component.html',
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
