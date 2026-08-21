'use strict';
function attachImages(page, images, include){ page.images = include ? (images||[]).slice(0,50) : []; return page; }
module.exports={attachImages};
