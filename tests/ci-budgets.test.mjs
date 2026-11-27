// Budgets: the checker must pass on the committed baseline and fail when a total is over.
import { compare, loadBudgets, measure } from '../tools/ci/check-budgets.mjs';

const ok = (c, m) => { if (!c) throw new Error(m); passed++; };
let passed = 0;

const budgets = loadBudgets();
ok(budgets.bundleBytes > 0, 'bundle budget is set');
ok(budgets.assetBytes > 0, 'asset budget is set');

const sizes = measure();
ok(sizes.bundle.bytes === budgets.bundleBytes, `bundle measure ${sizes.bundle.bytes} should match baseline ${budgets.bundleBytes}`);
ok(sizes.assets.bytes === budgets.assetBytes, `asset measure ${sizes.assets.bytes} should match baseline ${budgets.assetBytes}`);

const even = compare(sizes, budgets);
ok(even.every((r) => !r.over && r.delta === 0), 'current tree is within the baseline');

const overBundle = compare(sizes, { bundleBytes: budgets.bundleBytes - 1, assetBytes: budgets.assetBytes });
ok(overBundle[0].over && overBundle[0].delta === 1, 'bundle over by 1 byte fails');
ok(!overBundle[1].over, 'asset budget still holds in that case');

const overAssets = compare(sizes, { bundleBytes: budgets.bundleBytes, assetBytes: budgets.assetBytes - 1 });
ok(overAssets[1].over && overAssets[1].delta === 1, 'asset over by 1 byte fails');

const under = compare({ bundle: { bytes: 1, files: 1 }, assets: { bytes: 1, files: 1 } }, budgets);
ok(under.every((r) => !r.over), 'smaller totals pass');

console.log(`ok ${passed} ci-budgets`);
