#!/bin/sh
# Copy the static site into the app bundle. Xcode runs this on every build
# so the iPhone app and the website stay on the same files.
set -eu

if [ -z "${SRCROOT:-}" ] || [ -z "${TARGET_BUILD_DIR:-}" ] || [ -z "${WRAPPER_NAME:-}" ]; then
  echo "copy-web.sh must be run from the Black Ram Xcode build" >&2
  exit 1
fi

ROOT=$(CDPATH= cd "${SRCROOT}/.." && pwd)
DEST="${TARGET_BUILD_DIR}/${WRAPPER_NAME}/www"

rm -rf "${DEST}"
mkdir -p "${DEST}/brand" "${DEST}/icons" "${DEST}/fonts" "${DEST}/data"

for f in index.html styles.css app.js sw.js manifest.json manifest.webmanifest favicon.ico; do
  cp "${ROOT}/${f}" "${DEST}/${f}"
done

cp -R "${ROOT}/brand/." "${DEST}/brand/"
cp -R "${ROOT}/icons/." "${DEST}/icons/"
cp -R "${ROOT}/fonts/." "${DEST}/fonts/"
cp -R "${ROOT}/data/." "${DEST}/data/"

test -f "${DEST}/index.html"
test -f "${DEST}/app.js"
test -f "${DEST}/styles.css"
test -f "${DEST}/sw.js"
test -f "${DEST}/data/feed.json"
test -f "${DEST}/fonts/oswald-700.woff2"
test -f "${DEST}/brand/icon.svg"
