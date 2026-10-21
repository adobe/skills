# Offline copy of a store for the migration

I am migrating https://www.northwind-outdoor.com. Its pages load product
images from https://images.northwind-cdn.net, and the site sometimes blocks
repeated requests. I want to work on the pages for weeks without touching the
live site, so I want a local copy that I can replay with no network.

There is no network access in this environment, so do not run anything. Using the
page-cache skill, write `answer.md` with the exact commands, in order, to: start
the cache, fill it (with a browser, since the pages are JavaScript-rendered), check that
it filled, stop it, and replay it offline so that the images also work. Also say what happens
if I open a page I did not visit while filling it.
