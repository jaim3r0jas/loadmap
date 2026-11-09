---
'@loadmap/core': minor
'@loadmap/cli': minor
---

`loadmap drift x.loadmap (--snapshot now.json | --pull) --history dir/` finds what moved in the measured data while
no line of the definition did. Change points in each value across main's runs (E-divisive, kept only below a Welch
t-test's `--p-value`, 0.001 by default, as Apache Otava), named by the latest deploy before them in `--markers`; each
series against the last run's new points by a Mann-Whitney U test at 98 % with a 5 % dead zone (as Kayenta); and each
measured value, fit slope (above) and the first limit's headroom (below) against the band of main's last 30 runs
(`t_test`, `percentage` or `iqr`, as Bencher). It exits 1 on a drift and 3 when it cannot look; `--json` writes the result and `--issue` the body of an
issue. The statistics are `@loadmap/core/drift` (`changePoints`, `compareWindows`, `mannWhitney`, `threshold`,
`welch`), deterministic and with no dependencies. The guide has a nightly workflow that keeps the history in the
Actions cache and one issue up to date.
