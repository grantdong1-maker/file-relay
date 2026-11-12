# PRODUCT.md — file-relay

## What it is
A self-hosted website for relaying many or very large files between machines
and people. A sender uploads files in resumable chunks from any browser; the
server stores them locally and hands out plain download links (plus one bundle
link per batch). Zero dependencies: one Node.js process.

## Who uses it
The operator (self-hoster) and anyone they send a link to. No accounts, no
install, no technical knowledge required on the receiving side. Used from
laptops and phones, over a shared/public network, against one long-lived
server the operator keeps running.

## Jobs to be done
- Sender: "get these files off my machine and give out links, even if the
  files are huge or there are lots of them, even if my connection drops."
- Recipient: "download what was sent to me (or all of it at once) without
  signing up for anything."

## Modes
- Upload page (`/`): **Operate** — scanability and state clarity outrank
  expression. Progress, pause/resume, and copyable links are the product.
- Batch page (`/l/:id`): **Operate/Read** — a manifest of what arrived; the
  recipient acts (download) or waits (files still uploading).

## Product truths that must stay visible
- State honesty: queued / uploading / paused / done / failed must always be
  readable at a glance, per file.
- Links are the deliverable: every finished file exposes a copyable URL.
- Links expire; the page should make expiry legible, not hide it.
- Resumability is a feature, not an implementation detail (re-selecting a
  file continues where it left off).

## Constraints
- No build step, no framework, no runtime dependencies beyond Node itself.
- Static pages served by `server.js`; plain HTML/CSS/JS in `public/`.
- Design direction pinned by the operator: **cargo manifest / air waybill**
  aesthetic, light and dark grounds (system preference + manual toggle).
