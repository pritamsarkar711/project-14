# SumlyTools Schema

Tools are data entries with: `name`, `slug`, `desc`, `cat`, `type`, optional `cfg`, optional `popular`, and optional `icon`. Categories expose `key`, `name`, `color`, `icon`, `desc`, and a `tools` list. A single dynamic route `/tools/<slug>` loads metadata and lets the browser-side JavaScript engine render an interactive tool UI.
