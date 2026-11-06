# Cart total practice

A tiny, dependency-free practice project with one intentional bug: the cart total ignores quantity. Prices are integer cents, and inputs are non-negative integer prices and quantities. Validation, taxes, and discounts are out of scope.

Run from this directory:

```bash
node --test cart.test.js
```

The initial result is deliberately **2 passing and 2 failing tests**. A minimal fix in `cart.js` should make all **4 tests pass**. Keep the assertions unchanged so the test suite continues to check the intended behavior.

To explore Guang Code's actual file tools and permission gate without an API key, run `npm run tutorial` from the repository root. It uses a disposable copy, so this original fixture remains repeatable. The orchestration and repair in that tutorial are scripted, not produced by a model.

For the guided steps, safety boundaries, and a separate real-model exercise, see [the tutorial](../../docs/tutorial.md). Copy this folder before modifying it. No API key, network, package installation, or database is needed to run the sample's own tests.
