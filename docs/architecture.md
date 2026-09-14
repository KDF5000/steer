# Steer Architecture

## Product boundary

Steer is the business-facing workspace. Relay is execution infrastructure. Steer does not embed Relay's control plane and does not duplicate Node registration, Runtime health, scheduling, leases, or raw event storage.

```text
Browser
  └─ Steer Web
       └─ Steer Server
            ├─ PostgreSQL
            └─ Relay SDK / HTTP transport
                 └─ Relay Server
                      └─ Relay Nodes
                           ├─ Codex
                           ├─ Trae
                           └─ other Runtimes
```

## Ownership

Steer owns Workspace and future user context, Projects, Agent profiles, conversations, Run projections, and artifact metadata.

Relay owns Node registration, Runtime discovery, scheduling, leases, retries, cancellation, interactions, raw Run events, and artifact blobs.

Relay also owns generic workspace preparation. Its Workspace contract accepts
an opaque reuse identity and lifecycle policy, but never interprets them as a
Steer Project or Conversation. Steer maps a Conversation to that opaque key and
owns branch naming, review state, and user-visible cleanup decisions.

An existing-directory Project is placed on one Runtime and executes in place.
A Git Project is portable, but each Conversation pins the first resolved
Runtime and reuses one isolated worktree there. Changing Agents is allowed only
when the new Agent is compatible with that pinned Runtime; moving execution is
an explicit future fork/handoff operation.

## Repository and deployment

The Web client and Go server stay in one product repository so contracts can evolve atomically. They are separate processes and can be scaled independently. Relay remains a separate repository and deployment.

The Go server depends only on Relay's public SDK and HTTP transport at `github.com/KDF5000/relay`. It does not embed Relay database or control-plane implementations.

The local Compose stack includes Relay Server for one-command verification. Relay and Steer share a PostgreSQL instance but use separate databases so their schemas and migration lifecycles remain independent. In production they can be deployed and scaled separately. `RELAY_BASE_URL` is the private address Steer Server uses for API calls, while `RELAY_PUBLIC_URL` is the address shown to operators connecting remote Relay Nodes. See [Deployment topology](deployment.md).

## Data boundary

Every Steer business table contains `workspace_id`. The current MVP resolves a configured default Workspace while authentication is not implemented. This keeps the first deployment simple without baking single-tenancy into the schema.

Steer stores only the Run fields needed for its product experience. Relay remains the source of truth for execution state; Steer refreshes its projection when users observe a Run.

## Current transport

- Web → Steer Server: JSON HTTP API.
- Steer Server → Relay: Relay Go SDK over authenticated HTTP.
- Run updates: short polling in the Web client for the first closed loop.

The next transport improvement is a Steer-owned SSE endpoint that proxies projected updates. The browser should not connect to Relay directly because that would expose infrastructure credentials and protocol details.
