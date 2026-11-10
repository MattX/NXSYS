#!/bin/sh
# Regenerate golden/*.trace (and verify determinism by running each twice).
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
make -C "$HERE" >/dev/null
NX="$HERE/build/nxtrace"
OUT="$HERE/golden"
mkdir -p "$OUT"
rm -f "$OUT"/*.trace
IL="$ROOT/Interlockings"

gen() {  # name file
    "$NX" "$2" > "$OUT/$1.trace" 2> "$OUT/$1.stderr" || { echo "FAILED: $1" >&2; exit 1; }
    "$NX" "$2" 2>/dev/null | cmp -s - "$OUT/$1.trace" || { echo "NONDETERMINISTIC: $1" >&2; exit 1; }
    [ -s "$OUT/$1.stderr" ] || rm -f "$OUT/$1.stderr"
    echo "$1: $(wc -l < "$OUT/$1.trace") lines"
}

gen load-progman    "$IL/Progman/progman.trk"
gen load-islingtn   "$IL/Islington/islingtn.trk"
gen load-myrtle     "$IL/Myrtle/myrtle.trk"
gen load-atlantic   "$IL/Atlantic/atlantic.trk"
gen load-irt240     "$IL/irt240/irt.240tl.trk"
gen load-db7        "$IL/Duckburg/db7.trk"
gen load-dburg      "$IL/Duckburg/dburg.trk"
gen demo-Myrtle     "$IL/Myrtle/Myrtle.xdo"
for s in "$HERE"/scripts/*.xdo; do
    n=$(basename "$s" .xdo)
    gen "script-$n" "$s"
done
