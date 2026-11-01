# Practice-area defaults

Optional layer between `firms/_defaults.json` and each firm's `config.json`.

Add `firms/_defaults/<practice-area>.json` (e.g. `personal-injury.json` for "Personal Injury", the practice area in lowercase with hyphens) holding only the settings that differ for that practice area, then add its name (without `.json`) to `index.json`. Every firm with that practice area picks it up on its next sync and page load.
