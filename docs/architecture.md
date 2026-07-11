# Architecture — The Digital Map

> How every part of JMS Enterprise connects. Diagrams render automatically on GitHub.

---

## 1. System map (the whole picture)

```mermaid
graph TD
  subgraph Clients["Client Surfaces"]
    HTML["HTML Pages<br/>BACKEND/PUBLIC/*.html"]
    Mobile["Flutter App<br/>ios_app_demo/"]
    Desktop["Desktop App<br/>DESKTOP_APP/"]
    Scanner["Scanner Bridge<br/>CLIENT_BRIDGE/ :8999"]
  end

  subgraph Backend["Express Backend — BACKEND/"]
    App["createApp.js<br/>app wiring"]
    MW["Core Middleware<br/>auth, factory context"]
    Legacy["registerLegacyRoutes.js<br/>most /api routes"]
    Modules["src/modules/<br/>hrPerformance, interviewPanel"]
    SSE["sseManager.js<br/>live refresh events"]
  end

  DB[("PostgreSQL<br/>jms_v1")]

  HTML --> App
  Mobile --> App
  Desktop --> App
  Scanner --> App
  App --> MW --> Legacy --> DB
  MW --> Modules --> DB
  Legacy --> SSE
  SSE -. "refresh events" .-> HTML
```

---

## 2. LOCAL vs MAIN (the two-server model)

The app runs in two modes set by the `SERVER_TYPE` env var. This is the most important architectural idea in the project.

```mermaid
graph LR
  subgraph Factory["Factory Floor"]
    LOCAL["LOCAL Server<br/>SERVER_TYPE=LOCAL"]
    LDB[("Local PostgreSQL")]
    Scanners["Barcode Scanners"]
    LOCAL --> LDB
    Scanners --> LOCAL
  end

  subgraph Cloud["Hostinger VPS"]
    Traefik["Traefik reverse proxy"]
    MAIN["MAIN Server<br/>SERVER_TYPE=MAIN"]
    MDB[("Production PostgreSQL")]
    Traefik --> MAIN --> MDB
  end

  Internet(("Internet<br/>jmsocean.cloud")) --> Traefik
  LOCAL -- "HTTP sync<br/>/api/sync/*" --> MAIN
```

**Why two servers?** The factory must keep scanning and recording production even if the internet drops. LOCAL owns the shop floor; MAIN owns the internet-facing production DB. LOCAL pushes its data up to MAIN via `/api/sync/*` endpoints.

> ⚠️ On the VPS, the app compose file **must** keep its `traefik.*` labels or the whole site 404s — routing is handled by a shared-host Traefik.

---

## 3. A job's lifecycle (the core business flow)

This is what the software actually does, end to end:

```mermaid
graph LR
  Plan["Planning<br/>planning.html"] --> DPR["Production / DPR<br/>dpr.html"]
  DPR --> QC["Quality Control<br/>Quality.html / QCSupervisor.html"]
  QC --> Assembly["Assembly / Grinding<br/>assembly.html"]
  Assembly --> Shift["Shifting / WIP<br/>shifting_supervisor.html / wip.html"]
  Shift --> Dispatch["Dispatch / Reports<br/>reports.html"]
  HR["HR<br/>hr.html"] -.-> DPR
  Purchase["Purchasing<br/>purchase_orders.html"] -.-> Plan
```

| Stage | What happens | Main page |
|-------|-------------|-----------|
| **Planning** | Schedule which job runs on which machine/shift | `planning.html` |
| **Production (DPR)** | Record daily output per machine | `dpr.html` |
| **Quality** | Inspect & pass/reject batches | `Quality.html`, `QCSupervisor.html` |
| **Assembly / Grinding** | Post-moulding processing | `assembly.html`, `grinding.html` |
| **Shifting / WIP** | Move work-in-progress between locations | `shifting_supervisor.html`, `wip.html` |
| **Dispatch / Reports** | Final output & reporting | `reports.html` |

---

## 4. Request flow (what happens on one API call)

```mermaid
sequenceDiagram
  participant B as Browser page
  participant M as Middleware (auth + factory context)
  participant R as Route handler (registerLegacyRoutes)
  participant DB as PostgreSQL
  participant S as SSE manager

  B->>M: GET/POST /api/...
  M->>M: check session + resolve factory_id
  M->>R: forward request
  R->>DB: SQL query (scoped by factory_id)
  DB-->>R: rows
  R-->>B: JSON response
  R->>S: on write, broadcast "refresh"
  S-->>B: other open tabs auto-reload
```

**Key detail:** almost every query is scoped by `factory_id` (multi-factory support), resolved from the request context in `src/app/requestContext.js`. After any successful write, `sseManager` broadcasts a lightweight refresh so other open tabs update live.

---

## 5. Deploy pipeline

```mermaid
graph LR
  Feature["feature/*"] -->|PR| Develop["develop"]
  Develop -->|auto| Staging["Staging VPS :9093"]
  Develop -->|PR| Main["main"]
  Main -->|auto: publish-v1-app.yml| Prod["Production VPS<br/>jmsocean.cloud"]
```

- Push to **develop** → auto-deploys to **staging**.
- Merge **develop → main** → auto-builds the Docker image, pushes to GHCR, and deploys to the **production VPS** over SSH (with a safety DB dump + health check).
- Startup sequence is fixed and must never be reordered: **wait-postgres → auto-import → node server.js**.

See [../DEPLOYMENT.md](../DEPLOYMENT.md) and [../CLAUDE.md](../CLAUDE.md) for the full deploy reference.
