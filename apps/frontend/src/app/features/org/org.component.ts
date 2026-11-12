import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { ApiService, errMsg } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { UiSelectComponent } from '../../ui/ui-select.component';

interface Branch {
  _id: string;
  code: string;
  name: string;
  active: boolean;
}

interface User {
  _id: string;
  email: string;
  name: string;
  roles: string[];
  status: 'active' | 'disabled';
}

interface AuditEvent {
  _id: string;
  action: string;
  actorId?: string;
  at: string;
  details?: Record<string, unknown>;
}

const ROLES = ['owner', 'admin', 'branch_manager', 'cashier', 'inventory_operator', 'accountant'];

@Component({
  selector: 'app-org',
  standalone: true,
  imports: [FormsModule, DatePipe, UiSelectComponent],
  templateUrl: './org.component.html',
})
export class OrgComponent implements OnInit {
  private readonly api = inject(ApiService);
  readonly auth = inject(AuthService);

  readonly branches = signal<Branch[]>([]);
  readonly users = signal<User[]>([]);
  readonly audit = signal<AuditEvent[]>([]);
  readonly error = signal('');
  readonly busy = signal(false);
  readonly creatingUser = signal(false);

  readonly roles = ROLES;
  readonly roleOptions = ROLES.map((r) => ({ value: r, label: r }));
  branchName = '';
  branchCode = '';
  newUser = { name: '', email: '', password: '', role: 'cashier' };

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  async load(): Promise<void> {
    this.error.set('');
    try {
      this.branches.set(await this.api.get<Branch[]>('org/branches'));
      if (this.auth.hasPermission('users:manage')) {
        this.users.set(await this.api.get<User[]>('org/users'));
      }
      if (this.auth.hasPermission('audit:read')) {
        this.audit.set(await this.api.get<AuditEvent[]>('org/audit'));
      }
    } catch (e) {
      this.error.set(errMsg(e));
    }
  }

  async addBranch(): Promise<void> {
    if (!this.branchName.trim() || !this.branchCode.trim()) return;
    try {
      await this.api.post('org/branches', { name: this.branchName.trim(), code: this.branchCode.trim().toUpperCase() });
      this.branchName = '';
      this.branchCode = '';
      await this.load();
    } catch (e) {
      this.error.set(errMsg(e));
    }
  }

  async createUser(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      await this.api.post('org/users', {
        name: this.newUser.name.trim(),
        email: this.newUser.email.trim(),
        password: this.newUser.password,
        roles: [this.newUser.role],
      });
      this.creatingUser.set(false);
      this.newUser = { name: '', email: '', password: '', role: 'cashier' };
      await this.load();
    } catch (e) {
      this.error.set(errMsg(e));
    } finally {
      this.busy.set(false);
    }
  }

  async toggleUser(u: User): Promise<void> {
    try {
      await this.api.patch(`org/users/${u._id}`, { status: u.status === 'active' ? 'disabled' : 'active' });
      await this.load();
    } catch (e) {
      this.error.set(errMsg(e));
    }
  }
}
