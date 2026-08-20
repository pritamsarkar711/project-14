<?php
function categories(): array {
  $json = file_get_contents(__DIR__ . '/../assets/js/data.json');
  return json_decode($json, true)['categories'];
}
function all_tools(): array { $out=[]; foreach (categories() as $c) foreach ($c['tools'] as $t) $out[]=$t; return $out; }
function find_tool(string $slug): ?array { foreach (all_tools() as $t) if ($t['slug']===$slug) return $t; return null; }
function find_category(string $key): ?array { foreach (categories() as $c) if ($c['key']===$key) return $c; return null; }
function featured_tools(): array { return array_values(array_filter(all_tools(), fn($t)=>!empty($t['popular']))); }
