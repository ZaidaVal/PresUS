import { describe, expect, it } from 'vitest';
import { PRODUCT_NAME } from './branding';

describe('branding', () => {
  it('el nombre visible es PresUS', () => {
    expect(PRODUCT_NAME).toBe('PresUS');
  });
});
