# LED Spectrum Lab

Browser tool to measure (X-Rite i1 Pro via WebUSB, or a built-in demo simulator) and analyse LED spectra: CRI, TM-30, CIE, photometry, melanopic, spectral quality, two-source comparison, groups of repeated shots, X–Y plots, LED mixer.

- `measure.html` – measurement page
- `lab.html` – analysis page (both share the same browser storage and update each other live)
- `GUIDE.md` / `GUIDE.html` – user guide (also inside the pages, tab "Guide")
- `source/` – module sources; rebuild with `python3 source/build.py` (needs `pip install markdown`; output in `source/dist/`)

## GitHub Pages
Settings → Pages → Deploy from branch → `main` / root. The site is served over https, which WebUSB requires.
Open `https://<user>.github.io/<repo>/`.

Notes: data lives in each visitor's browser (IndexedDB) and is shared per origin. WebUSB works in Chrome/Edge only.

## License
AGPL-3.0-or-later. Add the license text via GitHub: Add file → Create new file → name it `LICENSE` → "Choose a license template" → GNU AGPLv3.
