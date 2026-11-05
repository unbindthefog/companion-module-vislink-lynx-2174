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

### Defaults

Two rules, agreed across all four of our Companion modules (2026-10-28), and
both learned here:

**A default is free to choose until someone else depends on it.** Before the
first release it is a decision; afterwards it is a change of behaviour for
every new connection, and that makes it a major bump. So settle defaults
before publishing, not after.

**A changed default never gets an upgrade script.** Companion applies a
field's default only on a connection's first init and never fills a missing
field in later, so existing connections keep their stored value on their own. A
migration would reach back and rewrite exactly the connections that are meant
to be left alone.

Keep the version identical in `package.json` and `companion/manifest.json`, and
make the git tag `v` + that version. A renamed or reshaped config field needs a
migration added to `src/upgrades.ts` so existing users' connections keep
working — a changed **default** is the one config change that must not get one,
for the reason above.

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

For a patch release, `yarn package` does the version bump itself — it raises the
patch number in `package.json` and `companion/manifest.json` together, so the two
cannot drift apart:

```bash
git checkout main && git pull

yarn format
yarn package                    # build + bump + write the .tgz

git commit -am "Release vX.Y.Z"
git push
git tag vX.Y.Z && git push origin vX.Y.Z
```

For a minor or major release, set the version in **both** files by hand first,
then build without the bump:

```bash
yarn build && yarn companion-module-build
```

Pushing the tag runs the **Release** workflow, which builds the package on a
clean checkout and attaches the `.tgz` to the GitHub release for that tag,
creating the release if it does not exist yet. It first checks that the tag
agrees with both version fields and fails the build on a mismatch, so a
mislabelled package never reaches a release.

That release asset is the file to hand to anyone who needs the module without a
local build — it goes into Companion under **Modules → Import module package**.

To get a current package _without_ cutting a release, run the same workflow by
hand (**Actions → Release → Run workflow**) and download the `module-package`
artifact from the run.

Finally, submit the version in the Developer Portal: **My Connections** → this
module → **Submit Version**.

Bitfocus reviews the submission and publishes it to the store.
