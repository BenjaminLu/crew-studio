# money-kit

A small TypeScript library for amounts of money in cents: add, split and format them without floating-point surprises.

It is the sandbox repository Crew Studio's coding workflow runs on. To publish it on GitHub, see [README_SANDBOX.md](README_SANDBOX.md).

## Use

```ts
import { add, format, split } from "./src/money";
format(add(1999, 1)); // "$20.00"
split(1000, 3);       // [334, 333, 333]
```

## Develop

```sh
bun test          # all tests
bun run lint      # style rules
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for branch names and commit messages.
