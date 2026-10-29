# Runtime integration verification

Validated against upstream Steer `466eef8` and Relay `v0.5.7` using an isolated
local account, PostgreSQL, Relay Server and one Node with three runtimes.
No test credentials are stored in this repository.

## Real runtime checks

- Qoder CLI 1.1.26 created a file through Write.
- QwenWork read that file and appended a line through Edit in the same conversation.
- Qoder resumed and recovered the intervening changes and the conversation marker.
- Codex CLI 0.157.0 joined the same conversation, read both lines and recovered the marker.
- Switching back to Qoder recovered Codex's reply and the marker.
- QwenWork's denied Bash call was captured as a failed tool result; its subsequent
  successful Edit remained visible as a confirmed file change.

The local QwenWork CLI is installed at
`/Applications/QwenWorkCN.app/Contents/Resources/bin/qoderclicn`. Avoid temporary
DMG mount paths in Node configurations. Both providers require separate CLI login.
`accept_edits` permits file changes but can still deny shell commands; the UI now
shows those failures instead of presenting them as successful actions.

## Automated checks

Run `npm test`, `npm run lint`, and `npm run build` from the repository root.
The frontend tests cover transport completion/cancellation, tool result matching,
confirmed versus proposed writes, denied tools, replay and Codex compatibility.

With a dedicated `STEER_TEST_DATABASE_URL`, run from `server/`:

```sh
go test -race ./internal/api -run 'TestProjectMachine|TestRuntimeBinding|Test.*Delegat' -count=1
go vet ./...
```

A full `go test ./...` run on the upstream baseline exposed unrelated failures:
concurrent schema migration creation, a JSONB snapshot compared as raw bytes,
and a workflow fixture whose fixed September dates exclude a work entry created
at the current time. These are not covered by the targeted passing checks.
