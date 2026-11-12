# file-relay

Self-hosted website for sending many (or very large) files between machines.
Zero dependencies — just Node.js (>= 16).

## Run

    node server.js                 # default port 8199
    PORT=3000 node server.js       # custom port
    RELAY_TTL_HOURS=72 node server.js   # default link lifetime
    RELAY_PASS=secret node server.js   # optional: require a password to upload

Then open `http://<this-machine>:8199`. People on your network open
`http://<your-ip>:8199` to send files to it, or you can share the resulting
links with them.

## Features

- **Large files** — streamed to disk in 8 MB chunks; server writes positionally
  to a preallocated sparse file, so nothing is buffered in memory and multi-GB
  files are fine.
- **Resumable uploads** — every chunk is acknowledged with an offset; reload the
  page and re-select the same file to continue where it left off.
- **Resumable downloads** — HTTP `Range` support, so `curl -C - -O URL` resumes.
- **Many files** — drag & drop files or whole folders; 3 files upload at once.
- **Batch link** — one URL (`/l/<batch>`) lists all files in a session; a
  "download all as .tar" option appears when several files are ready.
- **Expiry** — links die automatically (default 24 h); data is deleted after.

## API (for scripts)

    # resumable via chunks
    ID=$(curl -s -X POST localhost:8199/api/init \
         -H 'content-type: application/json' \
         -d '{"name":"big.iso","size":1048576,"listId":"mylist"}' | jq -r .id)
    curl -s -X PUT localhost:8199/api/chunk/$ID -H 'x-offset: 0' --data-binary @part1

    # or one-shot stream for a whole file
    curl -s -X POST localhost:8199/api/init -H 'content-type: application/json' \
         -d '{"name":"big.iso","size":1048576,"listId":"mylist"}'
    curl -s -X PUT "localhost:8199/api/stream/$ID?offset=0" -T big.iso

    # status / download
    curl localhost:8199/api/status/$ID
    curl -C - -O localhost:8199/d/$ID

## Notes

- Intended for trusted networks (LAN / VPN). There is no auth; put it behind a
  reverse proxy with TLS + auth if you expose it publicly.
- To let friends transfer files to you over longer distance, put Cloudflare
  Tunnel in front (install `cloudflared`, then `cloudflared tunnel --url
  http://localhost:8199`; share the `trycloudflare.com` URL). Set `RELAY_PASS`
  so only people who know your password can upload through the tunnel.

- Data lives in `data/` next to `server.js`; delete the folder to reset.
