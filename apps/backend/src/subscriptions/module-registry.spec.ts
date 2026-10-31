import { Industry, ModuleId } from '@mizan/shared';
import { DEFAULT_PLANS, validateModuleSet } from './module-registry';

describe('module registry', () => {
  it('accepts a valid supermarket module set', () => {
    const errors = validateModuleSet(
      [ModuleId.Catalog, ModuleId.Inventory, ModuleId.Sales, ModuleId.SupermarketOps],
      Industry.Supermarket,
    );
    expect(errors).toEqual([]);
  });

  it('rejects missing dependencies', () => {
    const errors = validateModuleSet([ModuleId.Inventory], Industry.Supermarket);
    expect(errors.some((e) => e.includes('requires'))).toBe(true);
  });

  it('rejects industry-incompatible modules', () => {
    const errors = validateModuleSet(
      [ModuleId.Catalog, ModuleId.Inventory, ModuleId.Sales, ModuleId.SupermarketOps],
      Industry.Restaurant,
    );
    expect(errors.some((e) => e.includes('not compatible'))).toBe(true);
  });

  it('rejects unimplemented modules', () => {
    const errors = validateModuleSet(
      [ModuleId.Catalog, ModuleId.Sales, ModuleId.RestaurantOps],
      Industry.Restaurant,
    );
    expect(errors.some((e) => e.includes('not yet available'))).toBe(true);
  });

  it('all default plans have valid module sets', () => {
    for (const plan of DEFAULT_PLANS) {
      expect(validateModuleSet(plan.modules, plan.industry)).toEqual([]);
    }
  });
});
