# Releasing

How to publish a new version of this module to the **Bitfocus Companion module
store**.

> TL;DR: bump the version in both files → merge to `main` with CI green → push a
> `vX.Y.Z` tag → submit the version in the Bitfocus Developer Portal.

## How Companion modules are distributed

Companion modules are **not** published to npm. Each lives in its own
`companion-module-*` GitHub repository. A git tag marks a release, CI validates
and packages it, and the maintainer submits that tag through the
[Developer Portal](https://developer.bitfocus.io/), which Bitfocus reviews and
lists in the in-app module store.

## One-time setup (before the first release)

1. Post in `#module-development` on the
   [Bitfocus Companion Discord](https://bitfocus.io/companion) with the GitHub
   username and the module name in `manufacturer-product` form — here
   **`vislink-lynx-2174`** — to have the module registered.
2. Sign in to the [Developer Portal](https://developer.bitfocus.io/) with
   GitHub. The module then appears under **My Connections**.

## Versioning

Semantic versioning:

| Bump  | When                                                                               |
| ----- | ---------------------------------------------------------------------------------- |
| patch | Bug fixes only.                                                                    |
| minor | New backward-compatible variables, feedbacks, actions or presets.                  |
| major | Breaking changes to config field names or shapes — **requires an upgrade script**. |

Keep the version identical in `package.json` and `companion/manifest.json`, and
make the git tag `v` + that version. Config field changes need a migration added
to `src/upgrades.ts` so existing users' connections keep working.

## Pre-release checklist

Enforced by CI (`bitfocus/actions` module-checks):

- [ ] Repo named `companion-module-*`, and manifest `id` matches the repo name
      without that prefix (`vislink-lynx-2174`)
- [ ] No leftover template placeholder text in the manifest
- [ ] Non-empty `products`, `runtime.type` is `node22`, `runtime.apiVersion` is
      `"0.0.0"`, and the entrypoint resolves (`../dist/main.js`)
- [ ] `companion/HELP.md` exists and documents config, variables and feedbacks
- [ ] Yarn only — no `package-lock.json`
- [ ] The packaged module builds and launches
- [ ] On a tagged build, `package.json` version equals the tag

Our own bar:

- [ ] `yarn format` produces no changes
- [ ] `yarn package` succeeds locally
- [ ] Tested against a **real** L2174, not only recorded `data.xml` samples
- [ ] `ROADMAP.md` updated for user-visible changes

## Release steps

```bash
git checkout main && git pull
git checkout -b release/vX.Y.Z

# bump "version" in package.json AND companion/manifest.json

yarn format
yarn package

git commit -am "Release vX.Y.Z"
git push -u origin release/vX.Y.Z
```

Once merged to `main` with CI green, create a GitHub Release with tag `vX.Y.Z`
(this tags and generates release notes in one step), then submit the version in
the Developer Portal: **My Connections** → this module → **Submit Version**.

Bitfocus reviews the submission and publishes it to the store.
