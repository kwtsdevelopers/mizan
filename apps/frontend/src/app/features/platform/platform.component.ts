import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { ApiService, errMsg, fmtMinor } from '../../core/api.service';
import { UiSelectComponent } from '../../ui/ui-select.component';

interface Tenant {
  tenantId: string;
  slug: string;
  name: string;
  industry: string;
  status: string;
  currency: string;
  timezone: string;
  createdAt: string;
  activatedAt?: string;
}

interface Plan {
  planId: string;
  name: string;
  industry: string;
  modules: string[];
  limits: { maxUsers: number; maxBranches: number; maxRegisters: number };
  priceMonthlyMinor: number;
  priceAnnualMinor: number;
  currency: string;
  trialDays: number;
}

interface ModuleInfo {
  id: string;
  name: string;
  description: string;
}

interface SubscriptionDetail {
  subscription: {
    planId: string;
    status: string;
    billingPeriod: string;
    startsAt: string;
    currentPeriodEndsAt: string;
  } | null;
  enabledModules: string[];
}

interface NewTenantForm {
  name: string;
  slug: string;
  slugTouched: boolean;
  industry: string;
  planId: string;
  billingPeriod: 'monthly' | 'annual';
  currency: string;
  timezone: string;
  adminName: string;
  adminEmail: string;
  adminPassword: string;
}

@Component({
  selector: 'app-platform',
  standalone: true,
  imports: [FormsModule, DatePipe, UiSelectComponent],
  templateUrl: './platform.component.html',
})
export class PlatformComponent implements OnInit {
  private readonly api = inject(ApiService);

  readonly tenants = signal<Tenant[]>([]);
  readonly plans = signal<Plan[]>([]);
  readonly moduleMap = signal<Map<string, ModuleInfo>>(new Map());
  readonly error = signal('');
  readonly message = signal('');
  readonly busy = signal(false);

  readonly form = signal<NewTenantForm | null>(null);
  readonly expanded = signal<string | null>(null);
  readonly detail = signal<SubscriptionDetail | null>(null);

  readonly industries = computed(() => [...new Set(this.plans().map((p) => p.industry))]);
  readonly plansForIndustry = computed(() => {
    const f = this.form();
    return f ? this.plans().filter((p) => p.industry === f.industry) : [];
  });
  readonly selectedPlan = computed(() => {
    const f = this.form();
    return f ? this.plans().find((p) => p.planId === f.planId) ?? null : null;
  });
  readonly industryOptions = computed(() => this.industries().map((i) => ({ value: i, label: this.industryLabel(i) })));
  readonly planOptions = computed(() =>
    this.plansForIndustry().map((p) => ({
      value: p.planId,
      label: `${p.name} — ${this.money(p.priceMonthlyMinor, p.currency)}/mo`,
    })),
  );
  readonly billingOptions = [
    { value: 'monthly', label: 'Monthly' },
    { value: 'annual', label: 'Annual' },
  ];

  async ngOnInit(): Promise<void> {
    await Promise.all([this.load(), this.loadPlans(), this.loadModules()]);
  }

  async load(): Promise<void> {
    this.error.set('');
    try {
      this.tenants.set(await this.api.get<Tenant[]>('platform/tenants'));
    } catch (e) {
      this.error.set(errMsg(e));
    }
  }

  async loadPlans(): Promise<void> {
    try {
      this.plans.set(await this.api.get<Plan[]>('plans'));
    } catch (e) {
      this.error.set(errMsg(e));
    }
  }

  async loadModules(): Promise<void> {
    try {
      const mods = await this.api.get<ModuleInfo[]>('modules');
      this.moduleMap.set(new Map(mods.map((m) => [m.id, m])));
    } catch {
      /* names fall back to raw ids */
    }
  }

  toggleCreate(): void {
    if (this.form()) {
      this.form.set(null);
      return;
    }
    const firstIndustry = this.industries()[0] ?? 'supermarket';
    const firstPlan = this.plans().find((p) => p.industry === firstIndustry);
    this.form.set({
      name: '',
      slug: '',
      slugTouched: false,
      industry: firstIndustry,
      planId: firstPlan?.planId ?? '',
      billingPeriod: 'monthly',
      currency: firstPlan?.currency ?? 'USD',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      adminName: '',
      adminEmail: '',
      adminPassword: '',
    });
  }

  onNameChange(f: NewTenantForm): void {
    if (!f.slugTouched) f.slug = slugify(f.name);
  }

  onIndustryChange(f: NewTenantForm): void {
    const first = this.plans().find((p) => p.industry === f.industry);
    f.planId = first?.planId ?? '';
  }

  canSubmit(f: NewTenantForm): boolean {
    return (
      f.name.trim().length > 0 &&
      /^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/.test(f.slug) &&
      !!f.planId &&
      /^[A-Za-z]{3}$/.test(f.currency) &&
      f.timezone.trim().length > 0 &&
      f.adminName.trim().length > 0 &&
      /\S+@\S+\.\S+/.test(f.adminEmail) &&
      f.adminPassword.length >= 10
    );
  }

  async create(f: NewTenantForm): Promise<void> {
    this.error.set('');
    this.message.set('');
    this.busy.set(true);
    try {
      const res = await this.api.post<{ tenantId: string; slug: string; status: string }>('tenants/register', {
        name: f.name.trim(),
        slug: f.slug,
        industry: f.industry,
        planId: f.planId,
        billingPeriod: f.billingPeriod,
        currency: f.currency.toUpperCase(),
        timezone: f.timezone.trim(),
        adminEmail: f.adminEmail.trim(),
        adminName: f.adminName.trim(),
        adminPassword: f.adminPassword,
      });
      this.message.set(
        `Tenant "${f.name}" created (${res.status}). The owner signs in with Business ID "${res.slug}" and the admin email/password you set.`,
      );
      this.form.set(null);
      await this.load();
    } catch (e) {
      this.error.set(errMsg(e));
    } finally {
      this.busy.set(false);
    }
  }

  async toggleDetail(t: Tenant): Promise<void> {
    if (this.expanded() === t.tenantId) {
      this.expanded.set(null);
      return;
    }
    this.expanded.set(t.tenantId);
    this.detail.set(null);
    try {
      this.detail.set(await this.api.get<SubscriptionDetail>(`platform/tenants/${t.tenantId}/subscription`));
    } catch (e) {
      this.error.set(errMsg(e));
    }
  }

  industryLabel(industry: string): string {
    return industry.charAt(0).toUpperCase() + industry.slice(1);
  }

  moduleName(id: string): string {
    return this.moduleMap().get(id)?.name ?? id;
  }

  moduleDesc(id: string): string {
    return this.moduleMap().get(id)?.description ?? '';
  }

  money(minor: number, currency: string): string {
    return `${fmtMinor(minor)} ${currency}`;
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

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
