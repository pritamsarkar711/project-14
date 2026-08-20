<?php function tool_family(string $type): string { return explode('-', $type)[0] ?: 'main'; } ?>
