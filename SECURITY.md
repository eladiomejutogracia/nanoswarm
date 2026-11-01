# Security

NanoSwarm runs in the browser and evaluates formulas written in its own small language. Formulas
never reach JavaScript's `eval`: they are parsed into a syntax tree, and only code generated from
that tree is compiled. A formula that escapes that sandbox, or any other way to run code or leak data
through a `<nano-swarm>` element, is a security bug.

## Reporting a vulnerability

Please report it privately through
[GitHub's private vulnerability reporting](https://github.com/eladiomejutogracia/nanoswarm/security/advisories/new),
not in a public issue. Include the element (or the steps) that reproduces it.

You will get an answer within a week. Fixes go into the latest version only.
