# Filmbaze CJS refresh fix

This package fixes:

```txt
ReferenceError: require is not defined in ES module scope
package.json contains "type": "module"
```

## What changed

The workflow now runs:

```bash
node scripts/refresh-cache-with-repair.cjs
```

instead of `.js`.

`.cjs` is always CommonJS, so `require()` works even when package.json has:

```json
"type": "module"
```

## Upload these files

```txt
.github/workflows/refresh-cache.yml
scripts/refresh-cache-with-repair.cjs
scripts/filmbaze-stream-repair.cjs
```

You can delete or ignore the old broken file:

```txt
scripts/refresh-cache-with-repair.js
```

## Important

If you already have a better `scripts/filmbaze-stream-repair.js`, keep it. The wrapper will try to run repair scripts in this order:

```txt
scripts/filmbaze-stream-repair.cjs
scripts/filmbaze-stream-repair.js
scripts/repair-filmbaze-streams.cjs
scripts/repair-filmbaze-streams.js
```
