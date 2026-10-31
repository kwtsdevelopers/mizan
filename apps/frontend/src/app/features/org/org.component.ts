import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { ApiService, errMsg } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';

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
  imports: [FormsModule, DatePipe],
  template: `
    <h1>Organization</h1>
    @if (error()) {
      <p class="error-text">{{ error() }}</p>
    }
    <div class="card">
      <div class="toolbar">
        <h2 style="margin: 0">Branches</h2>
        <span class="spacer"></span>
        <input name="bname" [(ngModel)]="branchName" placeholder="Branch name" style="max-width: 200px" />
        <input name="bcode" [(ngModel)]="branchCode" placeholder="CODE" style="max-width: 100px" />
        <button class="btn btn-primary btn-sm" (click)="addBranch()">Add</button>
      </div>
      <table class="grid">
        <thead><tr><th>Code</th><th>Name</th><th>Status</th></tr></thead>
        <tbody>
          @for (b of branches(); track b._id) {
            <tr>
              <td>{{ b.code }}</td>
              <td>{{ b.name }}</td>
              <td><span class="badge" [class.badge-ok]="b.active" [class.badge-muted]="!b.active">{{ b.active ? 'Active' : 'Inactive' }}</span></td>
            </tr>
          }
        </tbody>
      </table>
    </div>

    <div class="card">
      <div class="toolbar">
        <h2 style="margin: 0">Users</h2>
        <span class="spacer"></span>
        <button class="btn btn-primary btn-sm" (click)="creatingUser.set(!creatingUser())">New user</button>
      </div>
      @if (creatingUser()) {
        <div class="row">
          <div><label>Name</label><input name="uname" [(ngModel)]="newUser.name" /></div>
          <div><label>Email</label><input name="uemail" [(ngModel)]="newUser.email" /></div>
          <div><label>Password</label><input name="upass" type="password" [(ngModel)]="newUser.password" /></div>
          <div>
            <label>Role</label>
            <select name="urole" [(ngModel)]="newUser.role">
              @for (r of roles; track r) {
                <option [value]="r">{{ r }}</option>
              }
            </select>
          </div>
        </div>
        <button class="btn btn-primary btn-sm" style="margin-top: 10px" (click)="createUser()" [disabled]="busy()">Create</button>
      }
      <table class="grid" style="margin-top: 10px">
        <thead><tr><th>Name</th><th>Email</th><th>Roles</th><th>Status</th><th></th></tr></thead>
        <tbody>
          @for (u of users(); track u._id) {
            <tr>
              <td>{{ u.name }}</td>
              <td>{{ u.email }}</td>
              <td>{{ u.roles.join(', ') }}</td>
              <td><span class="badge" [class.badge-ok]="u.status === 'active'" [class.badge-danger]="u.status !== 'active'">{{ u.status === 'active' ? 'Active' : 'Disabled' }}</span></td>
              <td>
                <button class="btn btn-sm" (click)="toggleUser(u)">{{ u.status === 'active' ? 'Disable' : 'Enable' }}</button>
              </td>
            </tr>
          }
        </tbody>
      </table>
    </div>

    <div class="card">
      <h2>Audit log</h2>
      <table class="grid">
        <thead><tr><th>When</th><th>Actor</th><th>Action</th></tr></thead>
        <tbody>
          @for (a of audit(); track a._id) {
            <tr>
              <td>{{ a.at | date: 'short' }}</td>
              <td>{{ a.actorId }}</td>
              <td>{{ a.action }}</td>
            </tr>
          } @empty {
            <tr><td colspan="3" class="muted">No audit events.</td></tr>
          }
        </tbody>
      </table>
    </div>
  `,
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
