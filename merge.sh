script = """#!/bin/bash
# merge_all_to_main.sh
# This script merges all remote branches into main and deletes merged ones.

set -e

echo "Fetching all branches..."
git fetch --all

echo "Checking out main branch..."
git checkout main

echo "Merging all branches into main..."
for b in $(git branch -r | grep -v 'main' | grep -v 'HEAD' | sed 's/origin\\///'); do
  echo "Merging branch $b..."
  git merge origin/$b --no-edit || true
done

echo "Pushing merged main to origin..."
git push origin main

echo "Deleting merged remote branches..."
for b in $(git branch -r --merged | grep -v 'main' | grep -v 'HEAD' | sed 's/origin\\///'); do
  echo "Deleting branch $b..."
  git push origin --delete $b || true
done

echo "✅ All branches merged into main and redundant branches deleted."
"""

with open("/mnt/data/merge_all_to_main.sh", "w") as f:
    f.write(script)

"/mnt/data/merge_all_to_main.sh"
