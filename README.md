# Job Search Tracker

A free, private tool for running a job search. Keep every version of your resume, link each version to the application or person it went to, track where each application stands, and keep a history of your LinkedIn headline.

**Your data never leaves your browser.** There are no accounts, no tracking, and no server. Everything is saved in your browser on your own device. Use **Settings and backup → Download backup** to keep a copy or move to another computer.

## What it does

- **Resume versions:** paste your resume, save a new version each time you tailor it, compare any two versions line by line, and download a text-based PDF that applicant tracking systems can read.
- **Checks you set:** words every version must include, the years of experience you claim, team sizes, words to avoid, and em dashes.
- **Applications:** status from Interested to Offer, the version you sent, pay range, next step and date, with flags for overdue steps or pay below your target.
- **Contacts:** who you shared your resume with, which version, and when, with a warning when someone has an older version.
- **LinkedIn headline:** version history, a 220-character counter, and a check that the numbers match your current resume.

## Run it on your computer

You'll need [Node.js](https://nodejs.org) installed.

```bash
npm install      # download the packages the project needs
npm run dev      # start a private preview at http://localhost:4321
npm test         # run the automated tests
npm run build    # build the finished website into dist/
```

## License

MIT. The Carlito font used in PDFs is under the SIL Open Font License (see `public/fonts/OFL.txt`).
