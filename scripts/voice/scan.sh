#!/usr/bin/env bash
# Scan a docs site, workshop, or deck source tree for voice problems.
#
#   scan.sh [options] PATH...         # summary (files and/or directories): hits per pattern, worst first
#   scan.sh --files PATH              # hits per file, worst first (for splitting a sweep)
#   scan.sh --hits honest PATH        # file:line excerpts for patterns whose label matches
#   scan.sh --hits all --tier ban PATH
#
# Options:
#   --tier ban|watch|all   which tier to report (default: all)
#   --hits LABEL           print excerpts for patterns whose label contains LABEL ("all" = every pattern)
#   --files                print per-file hit totals instead of per-pattern
#   --ext LIST             comma-separated extensions to scan; a leading + appends to the default
#                          (default: md,markdown,html,adoc,txt,js,mjs,py,svg; e.g. --ext +sh,yaml
#                          to include demo-script narration and config comments)
#   --exclude NAME         prune a directory or file name (repeatable); _plans is pruned by default
#   --include-plans        scan _plans/ too (internal planning notes are not reader-facing)
#   --patterns FILE        extra TSV patterns (same format as patterns.tsv); repeatable
#   --raw                  do not blank fenced code blocks and inline `code` in Markdown
#   --fail                 exit 1 when any ban-tier pattern hits (pre-commit / CI gate)
#
# Read-only: the tree is never modified. Markdown is copied to a temp mirror with
# fenced code and inline code spans blanked (line numbers preserved), so commands,
# identifiers, and recorded output do not count as prose.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
pattern_files=("$here/patterns.tsv")
tier=all; hits=""; mode=summary; raw=0; fail=0
default_exts="md,markdown,html,adoc,txt,js,mjs,py,svg"
exts="$default_exts"
excludes=(_plans)
roots=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tier)     tier="$2"; shift 2 ;;
    --hits)     hits="$2"; mode=hits; shift 2 ;;
    --files)    mode=files; shift ;;
    --ext)      if [[ "$2" == +* ]]; then exts="$default_exts,${2#+}"; else exts="$2"; fi; shift 2 ;;
    --exclude)  excludes+=("$2"); shift 2 ;;
    --include-plans) excludes=("${excludes[@]/_plans}"); shift ;;
    --patterns) pattern_files+=("$2"); shift 2 ;;
    --raw)      raw=1; shift ;;
    --fail)     fail=1; shift ;;
    -h|--help)  sed -n '2,24p' "$0" | sed 's/^# \?//'; exit 0 ;;
    -*)         echo "unknown option: $1" >&2; exit 2 ;;
    *)          roots+=("$1"); shift ;;
  esac
done
[[ ${#roots[@]} -gt 0 ]] || { echo "usage: scan.sh [options] PATH... (see --help)" >&2; exit 2; }
for r in "${roots[@]}"; do [[ -e "$r" ]] || { echo "no such file or directory: $r" >&2; exit 2; }; done
case "$tier" in ban|watch|all) ;; *) echo "--tier must be ban, watch, or all" >&2; exit 2 ;; esac

# UTF-8 so curly apostrophes and em dashes match as single characters.
if locale -a 2>/dev/null | grep -qi '^c\.utf-\?8$'; then export LC_ALL=C.UTF-8; else export LC_ALL=en_US.UTF-8; fi

mirror="$(mktemp -d)"
trap 'rm -rf "$mirror"' EXIT

# --- Build the mirror: candidate files only, prose-only for Markdown.
find_args=()
IFS=',' read -ra ext_list <<< "$exts"
for e in "${ext_list[@]}"; do find_args+=(-o -name "*.$e"); done
find_args=("${find_args[@]:1}")
prune_args=()
for x in .git node_modules _site vendor target dist build .bundle .jekyll-cache \
         __pycache__ .venv venv .sass-cache "${excludes[@]}"; do
  [[ -n "$x" ]] && prune_args+=(-o -name "$x")
done
prune_args=("${prune_args[@]:1}")

while IFS= read -r -d '' f; do
  if [[ ${#roots[@]} -eq 1 && -d "${roots[0]}" ]]; then
    rel="$(realpath --relative-to="${roots[0]}" "$f")"
  else
    rel="$(realpath --relative-to=. "$f")"; rel="${rel#../}"; rel="${rel//..\//}"
  fi
  mkdir -p "$mirror/$(dirname "$rel")"
  if [[ $raw -eq 0 && "$f" =~ \.(md|markdown)$ ]]; then
    # Blank fenced blocks (``` / ~~~ / {% highlight %}) and inline code spans.
    awk '
      /^[[:space:]]*(```|~~~)/ { infence = !infence; print ""; next }
      /\{%-?[[:space:]]*highlight/    { inhl = 1; print ""; next }
      /\{%-?[[:space:]]*endhighlight/ { inhl = 0; print ""; next }
      infence || inhl { print ""; next }
      { gsub(/`[^`]*`/, ""); print }
    ' "$f" > "$mirror/$rel"
  else
    cp "$f" "$mirror/$rel"
  fi
done < <(find "${roots[@]}" \( "${prune_args[@]}" \) -prune \
  -o -type f \( "${find_args[@]}" \) ! -name '*.min.js' ! -name 'package-lock.json' -print0)

# --- Load patterns: tier \t case \t label \t regex
tiers=(); cases=(); labels=(); regexes=(); onlys=()
for pf in "${pattern_files[@]}"; do
  [[ -f "$pf" ]] || { echo "patterns file not found: $pf" >&2; exit 2; }
  while IFS=$'\t' read -r t c l r x; do
    [[ -z "$t" || "$t" == \#* ]] && continue
    [[ "$tier" != all && "$t" != "$tier" ]] && continue
    tiers+=("$t"); cases+=("$c"); labels+=("$l"); regexes+=("$r"); onlys+=("${x:-}")
  done < "$pf"
done

grep_pat() {  # grep_pat INDEX [-o]  -- with -o, print a ~70-char excerpt around each hit
  local i="$1" re="${regexes[$1]}" opt=()
  local ci=(); [[ "${cases[$i]}" == i ]] && ci=(-i)
  local inc=()  # optional 5th column: comma-separated extensions the pattern applies to
  if [[ -n "${onlys[$i]}" ]]; then
    local e; IFS=',' read -ra _exts <<< "${onlys[$i]}"
    for e in "${_exts[@]}"; do inc+=("--include=*.$e"); done
  fi
  if [[ "${2:-}" == -o ]]; then opt=(-o); re=".{0,70}(${re}).{0,70}"; fi
  grep -rnE "${ci[@]}" "${opt[@]}" "${inc[@]}" -e "$re" "$mirror" 2>/dev/null || true
}

ban_hits=0
out="$mirror/.out"; : > "$out"

case "$mode" in
  summary)
    for i in "${!labels[@]}"; do
      res="$(grep_pat "$i")"
      [[ -z "$res" ]] && continue
      n=$(printf '%s\n' "$res" | wc -l)
      nf=$(printf '%s\n' "$res" | cut -d: -f1 | sort -u | wc -l)
      [[ "${tiers[$i]}" == ban ]] && ban_hits=$((ban_hits + n))
      printf '%6d\t%5d\t%-5s\t%s\n' "$n" "$nf" "${tiers[$i]}" "${labels[$i]}" >> "$out"
    done
    printf '%6s\t%5s\t%-5s\t%s\n' LINES FILES TIER PATTERN
    sort -t$'\t' -k1,1nr "$out"
    total=$(awk -F'\t' '{s+=$1} END{print s+0}' "$out")
    echo "--"
    echo "total: $total matching lines ($ban_hits ban-tier) under ${roots[*]}"
    ;;
  files)
    for i in "${!labels[@]}"; do
      res="$(grep_pat "$i")"
      [[ -z "$res" ]] && continue
      printf '%s\n' "$res" | cut -d: -f1 >> "$out"
      [[ "${tiers[$i]}" == ban ]] && ban_hits=$((ban_hits + $(printf '%s\n' "$res" | wc -l)))
    done
    printf '%6s\t%s\n' HITS FILE
    sed "s|^$mirror/||" "$out" | sort | uniq -c | sort -k1,1nr | awk '{printf "%6d\t%s\n", $1, $2}'
    ;;
  hits)
    for i in "${!labels[@]}"; do
      [[ "$hits" != all && "${labels[$i],,}" != *"${hits,,}"* ]] && continue
      res="$(grep_pat "$i" -o | sed "s|^$mirror/||")"
      [[ -z "$res" ]] && continue
      [[ "${tiers[$i]}" == ban ]] && ban_hits=$((ban_hits + $(printf '%s\n' "$res" | wc -l)))
      echo "## [${tiers[$i]}] ${labels[$i]}"
      printf '%s\n' "$res" | awk -F: '!seen[$1":"$2]++'
      echo
    done
    ;;
esac

[[ $fail -eq 1 && $ban_hits -gt 0 ]] && exit 1
exit 0
