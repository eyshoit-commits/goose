#!/bin/bash
# merge_all_to_main_safe.sh
# This version skips branches that cause merge conflicts instead of stopping.

set -e

echo "Fetching all branches..."
git fetch --all

echo "Checking out main branch..."
git checkout main

echo "Merging all branches into main, skipping conflict branches..."
for b in $(git branch -r | grep -v 'main' | grep -v 'HEAD' | sed 's/origin\///'); do
  echo "Attempting to merge branch $b..."
  if git merge origin/$b --no-edit; then
    echo "Merged $b successfully."
  else
    echo "⚠️ Conflict detected in branch $b. Aborting merge and skipping..."
    git merge --abort || true
    continue
  fi
done

echo "Pushing merged main to origin..."
git push origin main

echo "Deleting merged remote branches..."
for b in $(git branch -r --merged | grep -v 'main' | grep -v 'HEAD' | sed 's/origin\///'); do
  echo "Deleting branch $b..."
  git push origin --delete $b || true
done

echo "✅ Merge complete! Conflicting branches were skipped safely."
