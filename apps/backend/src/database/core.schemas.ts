import { Schema, InferSchemaType, Model, Connection } from 'mongoose';
import { Industry, ModuleId, SubscriptionStatus, TenantStatus } from '@mizan/shared';

/**
 * Control-plane collections (database: mizan_core).
 * Tenant business transactions never live here.
 */

export const tenantSchema = new Schema(
  {
    tenantId: { type: String, required: true, immutable: true },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    slug: { type: String, required: true, lowercase: true, trim: true, maxlength: 60 },
    industry: { type: String, required: true, enum: Object.values(Industry) },
    status: {
      type: String,
      required: true,
      enum: Object.values(TenantStatus),
      default: TenantStatus.Provisioning,
    },
    /** server-controlled database name; never derived from user input */
    dbName: { type: String, required: true },
    /** placement: cluster key for multi-cluster deployments */
    clusterKey: { type: String, required: true, default: 'default' },
    currency: { type: String, required: true, default: 'USD', maxlength: 3 },
    timezone: { type: String, required: true, default: 'UTC' },
    createdAt: { type: Date, required: true, default: () => new Date() },
    activatedAt: { type: Date },
    suspendedAt: { type: Date },
  },
  { collection: 'tenants', versionKey: false },
);
tenantSchema.index({ tenantId: 1 }, { unique: true });
tenantSchema.index({ slug: 1 }, { unique: true });

export const planSchema = new Schema(
  {
    planId: { type: String, required: true },
    name: { type: String, required: true },
    industry: { type: String, required: true, enum: Object.values(Industry) },
    modules: { type: [String], required: true, enum: Object.values(ModuleId) },
    limits: {
      maxUsers: { type: Number, required: true, min: 1 },
      maxBranches: { type: Number, required: true, min: 1 },
      maxRegisters: { type: Number, required: true, min: 1 },
    },
    priceMonthlyMinor: { type: Number, required: true, min: 0 },
    priceAnnualMinor: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, maxlength: 3 },
    trialDays: { type: Number, required: true, min: 0, default: 14 },
    active: { type: Boolean, required: true, default: true },
  },
  { collection: 'plans', versionKey: false, timestamps: true },
);
planSchema.index({ planId: 1 }, { unique: true });

export const subscriptionSchema = new Schema(
  {
    tenantId: { type: String, required: true },
    planId: { type: String, required: true },
    status: { type: String, required: true, enum: Object.values(SubscriptionStatus) },
    billingPeriod: { type: String, required: true, enum: ['monthly', 'annual'] },
    startsAt: { type: Date, required: true },
    currentPeriodEndsAt: { type: Date, required: true },
    canceledAt: { type: Date },
    /** grace period end after payment failure/expiry; tenant is read-only after this */
    graceEndsAt: { type: Date },
  },
  { collection: 'subscriptions', versionKey: false, timestamps: true },
);
subscriptionSchema.index({ tenantId: 1 }, { unique: true });

export const platformAdminSchema = new Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    name: { type: String, required: true },
    status: { type: String, required: true, enum: ['active', 'disabled'], default: 'active' },
  },
  { collection: 'platform_admins', versionKey: false, timestamps: true },
);
platformAdminSchema.index({ email: 1 }, { unique: true });

export const PROVISIONING_STEPS = [
  'create_database',
  'apply_indexes',
  'seed_defaults',
  'create_admin_user',
  'create_subscription',
  'verify_isolation',
  'activate',
] as const;
export type ProvisioningStep = (typeof PROVISIONING_STEPS)[number];

export const provisioningJobSchema = new Schema(
  {
    tenantId: { type: String, required: true },
    status: {
      type: String,
      required: true,
      enum: ['pending', 'running', 'completed', 'failed'],
      default: 'pending',
    },
    completedSteps: { type: [String], required: true, default: [] },
    attempts: { type: Number, required: true, default: 0 },
    lastError: { type: String },
    /** input needed to (re)run provisioning idempotently */
    input: {
      planId: { type: String, required: true },
      adminEmail: { type: String, required: true },
      adminName: { type: String, required: true },
      /** bcrypt hash only - plaintext is never persisted */
      adminPasswordHash: { type: String, required: true },
    },
  },
  { collection: 'provisioning_jobs', versionKey: false, timestamps: true },
);
provisioningJobSchema.index({ tenantId: 1 }, { unique: true });

export const platformAuditSchema = new Schema(
  {
    at: { type: Date, required: true, default: () => new Date() },
    actorId: { type: String },
    actorScope: { type: String },
    action: { type: String, required: true },
    tenantId: { type: String },
    details: { type: Schema.Types.Mixed },
  },
  { collection: 'platform_audit', versionKey: false },
);
platformAuditSchema.index({ at: -1 });
platformAuditSchema.index({ tenantId: 1, at: -1 });

export type TenantDoc = InferSchemaType<typeof tenantSchema>;
export type PlanDoc = InferSchemaType<typeof planSchema>;
export type SubscriptionDoc = InferSchemaType<typeof subscriptionSchema>;
export type PlatformAdminDoc = InferSchemaType<typeof platformAdminSchema>;
export type ProvisioningJobDoc = InferSchemaType<typeof provisioningJobSchema>;
export type PlatformAuditDoc = InferSchemaType<typeof platformAuditSchema>;

export interface CoreModels {
  tenants: Model<TenantDoc>;
  plans: Model<PlanDoc>;
  subscriptions: Model<SubscriptionDoc>;
  platformAdmins: Model<PlatformAdminDoc>;
  provisioningJobs: Model<ProvisioningJobDoc>;
  platformAudit: Model<PlatformAuditDoc>;
}

export function registerCoreModels(conn: Connection): CoreModels {
  return {
    tenants: conn.model<TenantDoc>('Tenant', tenantSchema),
    plans: conn.model<PlanDoc>('Plan', planSchema),
    subscriptions: conn.model<SubscriptionDoc>('Subscription', subscriptionSchema),
    platformAdmins: conn.model<PlatformAdminDoc>('PlatformAdmin', platformAdminSchema),
    provisioningJobs: conn.model<ProvisioningJobDoc>('ProvisioningJob', provisioningJobSchema),
    platformAudit: conn.model<PlatformAuditDoc>('PlatformAudit', platformAuditSchema),
  };
}
