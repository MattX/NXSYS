#!/bin/sh
# Regenerate golden/*.trace and golden/draw/*.nxdraw (and verify determinism by running each twice).
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
make -C "$HERE" >/dev/null
NX="$HERE/build/nxtrace"
OUT="$HERE/golden"
mkdir -p "$OUT"
rm -f "$OUT"/*.trace
DRAW="$OUT/draw"
rm -rf "$DRAW"
mkdir -p "$DRAW"
: > "$DRAW/MANIFEST"
IL="$ROOT/Interlockings"

# Paint times for a run: load-only runs (END at the settle time) get one paint at END; demos/scripts
# get a paint every 2500 ms (switches moving, routes lit, signals clearing, flashing phases) plus one at END.
draw_times() {  # kind end
    if [ "$1" = load ]; then echo "$2"; return; fi
    t=2500; l=""
    while [ "$t" -lt "$2" ]; do l="$l$t,"; t=$((t + 2500)); done
    echo "$l$2"
}

# Painting must neither change the trace nor be nondeterministic.
gen_draw() {  # name file kind
    end=$(sed -n 's/^@\([0-9]*\) END$/\1/p' "$OUT/$1.trace")
    times=$(draw_times "$3" "$end")
    base=$(basename "$2")
    tmp=$(mktemp -d)
    "$NX" --draw-at "$times" --draw-dir "$DRAW" "$2" 2>/dev/null | cmp -s - "$OUT/$1.trace" || { echo "DRAWING CHANGED TRACE: $1" >&2; exit 1; }
    "$NX" --draw-at "$times" --draw-dir "$tmp" "$2" >/dev/null 2>&1
    for f in "$tmp"/*.nxdraw; do
        cmp -s "$f" "$DRAW/$(basename "$f")" || { echo "NONDETERMINISTIC DRAW: $f" >&2; exit 1; }
    done
    rm -rf "$tmp"
    rel=${2#"$ROOT"/}
    printf '%s\t%s\n' "$rel" "$times" >> "$DRAW/MANIFEST"
    echo "$1: $(echo "$times" | tr ',' '\n' | wc -l) draws"
}

gen() {  # name file kind(load|demo)
    "$NX" "$2" > "$OUT/$1.trace" 2> "$OUT/$1.stderr" || { echo "FAILED: $1" >&2; exit 1; }
    "$NX" "$2" 2>/dev/null | cmp -s - "$OUT/$1.trace" || { echo "NONDETERMINISTIC: $1" >&2; exit 1; }
    [ -s "$OUT/$1.stderr" ] || rm -f "$OUT/$1.stderr"
    echo "$1: $(wc -l < "$OUT/$1.trace") lines"
    gen_draw "$1" "$2" "$3"
}

gen load-progman    "$IL/Progman/progman.trk" load
gen load-islingtn   "$IL/Islington/islingtn.trk" load
gen load-myrtle     "$IL/Myrtle/myrtle.trk" load
gen load-atlantic   "$IL/Atlantic/atlantic.trk" load
gen load-irt240     "$IL/irt240/irt.240tl.trk" load
gen load-db7        "$IL/Duckburg/db7.trk" load
gen load-dburg      "$IL/Duckburg/dburg.trk" load
gen demo-Myrtle     "$IL/Myrtle/Myrtle.xdo" demo
for s in "$HERE"/scripts/*.xdo; do
    n=$(basename "$s" .xdo)
    gen "script-$n" "$s" demo
done

# ---- Phase 5 tool recordings: golden/tools/<file>@<ms>.draft<k>.nxdraw | .fullsig<N>.nxdraw | .status ----
# Spec in tools-spec.txt. Each run is also checked to leave the relay trace unchanged and to be deterministic.
TOOLS="$OUT/tools"
rm -rf "$TOOLS"
mkdir -p "$TOOLS"
grep -v '^#' "$HERE/tools-spec.txt" | while IFS="$(printf '\t')" read -r src times pages sigs; do
    [ -n "$src" ] || continue
    args=""
    oldifs=$IFS; IFS=';'
    for pg in $pages; do args="$args --draft-relays $pg"; done
    IFS=$oldifs
    base=$(basename "$src")
    tn=$(basename "$src" .xdo | sed 's/\.trk$//')
    tn=$( [ "${src##*.}" = xdo ] && echo "script-$tn" || echo "load-$tn")
    tmp=$(mktemp -d)
    # shellcheck disable=SC2086
    "$NX" --tool-at "$times" --status-at "$times" $args --fullsig "$sigs" --draw-dir "$TOOLS" "$ROOT/$src" 2>"$tmp/stderr" | cmp -s - "$OUT/$tn.trace" \
        || { echo "TOOL RECORDING CHANGED TRACE: $src" >&2; exit 1; }
    # shellcheck disable=SC2086
    "$NX" --tool-at "$times" --status-at "$times" $args --fullsig "$sigs" --draw-dir "$tmp" "$ROOT/$src" >/dev/null 2>&1
    for f in "$tmp"/*; do
        [ "$(basename "$f")" = stderr ] && continue
        cmp -s "$f" "$TOOLS/$(basename "$f")" || { echo "NONDETERMINISTIC TOOL OUTPUT: $f" >&2; exit 1; }
    done
    rm -rf "$tmp"
    echo "tools $base: $(ls "$TOOLS" | grep -c "^$base@") files"
done
