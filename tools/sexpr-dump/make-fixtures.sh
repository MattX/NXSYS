#!/bin/sh
# Regenerates web/packages/core/test/fixtures/sexpr-dump/*.txt from the real C++ reader.
set -e
cd "$(dirname "$0")"
make -s
OUT=../../web/packages/core/test/fixtures/sexpr-dump
IL=../../Interlockings
mkdir -p "$OUT"
for pair in progman:Progman/progman islington:Islington/islingtn myrtle:Myrtle/myrtle \
            atlantic:Atlantic/atlantic duckburg:Duckburg/db7 irt240:irt240/irt.240tl; do
  name=${pair%%:*}; path=${pair#*:}
  ./sexpr-dump "$IL/$path.trk" > "$OUT/$name.txt"
  echo "$name: $(wc -l < "$OUT/$name.txt") lines"
done
./sexpr-edge < edge-cases.txt > "$OUT/edge.txt"
cp edge-cases.txt "$OUT/edge-cases.txt"
echo "edge: $(grep -c ^CASE "$OUT/edge.txt") cases"
