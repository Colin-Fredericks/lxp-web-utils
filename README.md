# LXPediter Web Utilities

This Typescript + Webpack project produces a purely client-side web application that makes bulk changes to LXP courses.

## Gratitude

Thank you very much to GitHub user [jospete](https://github.com/jospete), creator of the [@obsidize/tar-browserify](https://jospete.github.io/obsidize-tar-browserify/index.html) package, for their hours of work upgrading their tar package to handle long filenames. Like loooooong ones. This is harder than you'd think.

Thank you also to my higher-ups at Harvard VPAL, who believe in me when I say things like "This is going to save us so much time in the long run" and give me the space to do this kind of work. In my defense, I am usually right about it.

## Functionality

Download a course export from the LXP. Open the expediter page, select your file, pick the options you want, and click "Go". For larger courses (100MB+) it'll take a while and may give you a temporary "This page is slowing down your browser" message.

You can make the following changes to a course export. Each bullet point is independant - you can change all or none of these settings simultaneously.

* Make all sections locked or unlocked
* Make all sections required or optional
* Allow or disallow scrubbing on all videos
* Collapse all sections on each page into a single section, or break all TEs out into their own individual section
* Collect a sequence of (HTML + video + expandable) into a single section if they're in separate sections
* Show questions within each question set all at once or one at a time
* Select when to display answers for all question sets
* Change the passing percentage and number of attempts for all question sets
* Clean the course for import back into the LXP. This will eventually be unnecessary, but the LXP currently (03Jan2025) exports some TEs that it cannot import.

The app also provides two spreadsheets: one shows the structure of the course, including all teaching elements and questions, and the other shows all links in the course that are *not* inside Credits expandables. You can turn them off if you want, or you can request *just* those.

### Security

This application works entirely client-side. You're not actually uploading your course tarball anywhere; everything happens right on your computer. We don't log anything. Whomever runs the server that this application sits on might log things like access date/time, IP address, etc. but they don't get the course file.

## Installation

If you want to use the web app, all you need is access to the page it runs on. No further programming knowledge needed.

If you want to generate that page yourself:

* Clone the repo.
* Make sure you have Typescript and Node available.
  * This was developed using node 20.9.0, npm 10.9.0, nvm 0.39.5, and Typescript 5.2.2, but it shouldn't be particularly picky about them.
* `cd` into the repo folder.
* `npm install`
  * Depending on your version of node, you might see a lot of `npm WARN EBADENGINE Unsupported engine`, but I haven't seen it cause an actual problem.
* `npm run build`
* `npm run start`
* You can access the page at `http://[::]:8080/index.html` or `http://localhost:8080/index.html`
* If you want a minified version, `npm run prod`

## Development

If you'd like to make changes to this tool:

* It uses Bootstrap for layout, Pako for gzip, @obsidize/tar-browserify for tar, Webpack for bundling, and Papaparse for CSV parsing.
  * For the love of god do not roll your own CSV parser. You can look for a lighter-weight one than Papaparse if you really want, but if I catch you using `file_text.split(",")` I will disown you.
* You can find theoretically up-to-date data documentation for the LXP export format at [TE And Crumpets](https://refactored-adventure-qzlyrlk.pages.github.io/). Harvard Key access required.
* There is no test package, because the real test of whether this is working is whether you can actually import its output to the LXP.
* I do invite pull requests
* I may or may not not build in any functionality you request, depending on time and whether it'll be useful to my team.
