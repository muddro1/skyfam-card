# Feeding the Photos tab from an outside photo library

The card only *reads* photo URLs — it never moves files. This page shows two
common ways to keep a set of photos available at `/local/…` and how the
manifest file is shaped. Everything here runs on the Home Assistant host or
anywhere else that can write to its `www/` folder; nothing is specific to a
particular NAS or vendor.

## Manifest shape

Point `photos_manifest:` at any URL returning JSON — a plain array, or an
object with a `photos` key. Entries are URLs or `{url, caption}` pairs:

```json
[
  "https://example.com/photos/sunset.jpg",
  { "url": "/local/photos/beach.jpg", "caption": "Family, 2025" }
]
```

The manifest is refetched when the tab opens and every 5 minutes, so rotating
a new list in needs no YAML edit and no restart. Failed fetches keep the last
good list.

## Option A — a synced folder plus a generated manifest

If your photos live somewhere else (a NAS share, an external disk, a cloud
sync folder), a small scheduled script can copy the newest N images into
`/config/www/photos/`, drop anything no longer in the source, and regenerate
`photos.json`. Sketch:

```sh
#!/bin/bash
# weekly cron: refresh /config/www/photos from a mounted photo folder
SRC=/mnt/photoshare        # read-only mount or any folder with the originals
DST=/config/www/photos     # served at /local/photos/ by Home Assistant
N=50

mkdir -p "$DST.tmp"
ls -t "$SRC" | grep -iE '\.(jpg|jpeg|png)$' | head -n "$N" | while read -r f; do
  cp "$SRC/$f" "$DST.tmp/$f"
done
rm -rf "$DST"; mv "$DST.tmp" "$DST"

# rebuild the manifest; embeds captions when filenames carry them:
#   beach__Sunset at the lake.jpg  ->  caption "Sunset at the lake"
python3 - "$DST" <<'PY'
import json, os, sys
d = sys.argv[1]
items = []
for f in sorted(os.listdir(d)):
    if not f.lower().endswith((".jpg", ".jpeg", ".png")):
        continue
    stem, _, rest = f.partition(".")
    name, *cap = stem.split("__", 1)
    item = {"url": "/local/photos/" + f}
    if cap:
        item["caption"] = cap[0].replace("_", " ")
    items.append(item)
json.dump(items, open(os.path.join(d, "photos.json"), "w"), indent=1)
PY
```

Mount a remote share read-only and copy into `www/` instead of serving the
mount directly: if the server holding the photos is ever down, the card keeps
showing the last copy instead of a wall of broken images, and the mount cannot
hang Home Assistant's own file access.

## Option B — a hand-maintained manifest

Skip the folder entirely: list `https://` URLs (or `/local/…` files you placed
by hand) in a `photos.json` you edit whenever you like. Good for a framed
wall display you curate occasionally; the 5-minute refetch picks up edits
within minutes.

## Notes

- `/local/…` paths are unauthenticated static files — fine on a LAN display,
  do not expose `www/` to the internet.
- The card fetches images as normal web requests: no Home Assistant login or
  media-source tokens involved. Authenticated media URLs will not load.
- Captions come from the manifest (`{url, caption}`), from the `__` filename
  convention if your generator supports it, or nowhere — the card itself does
  no captioning.
