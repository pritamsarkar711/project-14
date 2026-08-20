<?php function card($tool) { echo '<a class="card" href="/tools/'.htmlspecialchars($tool['slug']).'"><h3>'.htmlspecialchars($tool['name']).'</h3><p>'.htmlspecialchars($tool['desc']).'</p></a>'; } ?>
