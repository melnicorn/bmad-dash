# Architecture

A small sample doc for trying out the Documents viewer — in particular the
Mermaid diagram rendering with pan/zoom controls (scroll or drag on a
diagram, or use the +/−/reset buttons in the corner).

## Request flow

```mermaid
flowchart TD
    A[Client] -->|HTTP request| B(Express Server)
    B --> C{Route match?}
    C -->|yes| D[Handler]
    C -->|no| E[404]
    D --> F[(Database)]
    D -.->|async| G[Cache]
```

## Auth sequence

```mermaid
sequenceDiagram
    participant U as User
    participant S as Server
    participant DB as Database
    U->>S: POST /login
    S->>DB: verify credentials
    DB-->>S: user record
    S-->>U: 200 OK <br/> session token
    Note over U,S: Diagram source uses --> and <br/> chars
```

## A regular code block, for comparison

```ts
export function add(a: number, b: number): number {
  return a + b
}
```
