import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, errMsg } from '../../core/api.service';
import { UiSelectComponent } from '../../ui/ui-select.component';

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
  imports: [FormsModule, UiSelectComponent],
  templateUrl: './suppliers.component.html',
})
export class SuppliersComponent implements OnInit {
  private readonly api = inject(ApiService);

  readonly suppliers = signal<Supplier[]>([]);
  readonly error = signal('');
  readonly busy = signal(false);
  readonly form = signal<{ _id?: string; name: string; phone: string; email: string; status: 'active' | 'archived' } | null>(null);
  readonly statusOptions = [
    { value: 'active', label: 'Active' },
    { value: 'archived', label: 'Archived' },
  ];

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
