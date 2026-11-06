import assert from 'node:assert/strict';
import test from 'node:test';
import { totalCents } from './cart.js';

test('empty cart costs zero', () => {
  assert.equal(totalCents([]), 0);
});

test('one item keeps its price', () => {
  assert.equal(totalCents([{ priceCents: 1250, quantity: 1 }]), 1250);
});

test('multiple units and products include every quantity', () => {
  assert.equal(totalCents([
    { priceCents: 1250, quantity: 2 },
    { priceCents: 350, quantity: 3 },
  ]), 3550);
});

test('zero quantity does not contribute to the total', () => {
  assert.equal(totalCents([{ priceCents: 1250, quantity: 0 }]), 0);
});
