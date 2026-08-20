<?php
$uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if (preg_match('#^/tools/([a-z0-9-]+)/?$#', $uri, $m)) { $_GET['slug']=$m[1]; require __DIR__.'/tools/tool.php'; return; }
if (preg_match('#^/category/([a-z0-9-]+)/?$#', $uri, $m)) { $_GET['cat']=$m[1]; require __DIR__.'/category.php'; return; }
$map=['/'=>'index.php','/all-tools'=>'all-tools.php','/about'=>'about.php','/contact'=>'contact.php','/privacy'=>'privacy.php','/terms'=>'terms.php'];
require __DIR__.'/'.($map[rtrim($uri,'/')?:'/'] ?? '404.php');
