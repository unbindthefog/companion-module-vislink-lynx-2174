# companion-module-vislink-lynx-2174

A [Bitfocus Companion](https://bitfocus.io/companion) module for the
**Vislink Lynx L2174** RF broadcast receiver. It polls the receiver's built-in
`data.xml` status page and exposes RF lock, per-channel power/MER, decoder
status, temperatures and alarms as Companion variables and feedbacks.

End-user documentation lives in [`companion/HELP.md`](companion/HELP.md).
Notes on the receiver's (undocumented) API, gathered by exploring a live unit
read-only, live in [`docs/LYNX_L2174_API.md`](docs/LYNX_L2174_API.md).

> **A connection can be set to read only**, and then there are no actions at
> all — the list is empty, so nothing can be placed, and a button saved earlier
> is refused in the client. Otherwise:
>
> **Writes are a short allowlist, not a free hand.** Of the 88 parameters the
> receiver's own web interface can set, the module changes 28 for its everyday
> actions and 8 more only when a per-connection switch is on: preset recall,
> preset store, reboot, and the four downconverter supplies — the last of which
> put DC on an antenna input, so the switch guards a hardware risk and not only
> an interruption. Everything else the receiver would accept is refused in
> `src/api.ts`, next to the request that would carry it out. The receiver has no
> authentication and its own guard is inert, so the refusal has to live here.
> See [`ROADMAP.md`](ROADMAP.md).

## Development

Requires Node 22+ and Yarn 4 (via Corepack).

```bash
corepack enable
yarn install
yarn build
```

To load the module into Companion, point Companion's developer modules path at
the **parent directory** of this repository (Launcher → gear icon →
Developer), or set `COMPANION_DEV_MODULES=/path/to/parent`. Companion reloads
the module automatically when files change.

## Layout

| Path                     | Purpose                                                               |
| ------------------------ | --------------------------------------------------------------------- |
| `src/main.ts`            | Instance lifecycle, polling loop, status handling                     |
| `src/api.ts`             | Serialized HTTP client that fetches and parses `data.xml`             |
| `src/variables.ts`       | Variable definitions and the pure params → variable mapping           |
| `src/feedbacks.ts`       | Feedback definitions                                                  |
| `src/types.ts`           | Raw parameter shape and the alarm-bit / channel-id constants          |
| `docs/LYNX_L2174_API.md` | Notes on the receiver's API, gathered by exploring a device read-only |

## Releasing

See [`RELEASING.md`](RELEASING.md).

## License

MIT
