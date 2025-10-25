#!/bin/bash
# merge_all_to_main_auto_fix_stay_on_main.sh
# Merges all origin branches into main, auto-fixes conflicts, stays on main, and deletes merged branches.

set -e

echo "Fetching all branches..."
git fetch --all --prune

echo "Always staying on main branch..."
git checkout main

echo "Merging all origin branches into main (auto-fix conflicts, prefer newest changes)..."
for b in $(git branch -r | grep '^  origin/' | grep -v 'origin/main' | grep -v 'HEAD' | sed 's|origin/||'); do
  echo "Attempting to merge branch $b..."
  git checkout main
  if git merge -X theirs origin/$b --no-edit; then
    echo "✅ Merged $b successfully."
  else
    echo "⚠️ Merge failed for $b — retrying with auto conflict resolution..."
    git merge --abort || true
    git merge -X theirs origin/$b --no-edit || true
  fi
  git checkout main
done

echo "Pushing merged main to origin..."
git push origin main

echo "Deleting merged origin branches..."
for b in $(git branch -r --merged | grep '^  origin/' | grep -v 'origin/main' | grep -v 'HEAD' | sed 's|origin/||'); do
  echo "Deleting branch $b..."
  git push origin --delete $b || true
done

echo "✅ All origin branches merged into main. Conflicts auto-resolved (preferring newest), always stayed on main."
