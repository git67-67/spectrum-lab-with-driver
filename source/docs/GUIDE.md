# LED Spectrum Lab: user guide

LED Spectrum Lab is two single-file web pages that share one database in your browser:

| Page | Job |
|---|---|
| **measure.html** | Connect the i1 Pro (or the demo), calibrate, take measurements, put them into groups. Shows the full analysis of what you just measured. |
| **lab.html** | Analyse, compare and plot everything that was measured. Also the LED library and mixer of the original Lab. |

Both pages show the same analysis tabs. Open both from the **same folder / web address in the same browser profile**: they update each other within a second or two, so you can measure on one screen and watch CRI, TM-30, spectrum and colour on the other.

[TOC]

---

## 1. Quick start {#quickstart}

1. Open `measure.html` in **Chrome or Edge** (WebUSB exists only in Chromium browsers). The page must be `https://`, `localhost` or a local file.
2. Press **Connect i1 Pro** and choose the instrument, or press **Demo** (a simulator, no hardware needed).
3. Cover the sensor (cap on, or lay the instrument on a dark surface) and press **Dark calibration** (about 5 s).
4. In the **Group** card type a name, the LED / device name, the **current (mA)** and **voltage (V)** (and temperature if you like).
5. Point the instrument at the LED and press **● Measure** (or the space bar, or the button on the instrument). Set "× N shots" first to repeat the measurement; all N shots land in the group and their mean is the group's result.
6. Look at the tabs (Overview, Spectrum, CIE, CRI, TM-30 …). Everything is computed from the active group, live.
7. For the next operating point press **Next condition**: it starts a new group with the same LED and asks for the next current.
8. On `lab.html` (or the **Measurements**, **Overlay** and **X–Y plots** tabs) compare the groups: spectra on top of each other, or any quantity against any other (flux vs current, Duv vs flux, peak wavelength vs temperature …).

> **Back up your data.** Everything lives in the browser's database. Use *Measurements → Export → All measurements (.json)* regularly.

---

## 2. How it works {#how}

### 2.1 Shot → group → analysis {#how-groups}

* A **shot** is one reading of the instrument: a spectrum from 380 to 730 nm on a 1 nm grid (spectral irradiance, mW/m²/nm), plus the 128 raw sensor pixel values and the instrument settings (integration time, frames, peak counts, calibration used, kernel used).
* A **group** collects shots that belong together, normally **repeats of the same measurement**, to average out noise. It also carries the *operating point*: LED name, current, voltage, power, temperature, tags, a note, and any extra fields you define.
* **A group is shown as one measurement**: its spectrum is the mean of its *included* shots. You can untick a shot (outlier) to leave it out of the mean, or look at a single shot. Nothing is ever deleted unless you delete it.
* The standard deviation of the shots is kept and used as **error bars** in the X–Y plots.
* All analysis (CCT, Duv, CRI, TM-30, photometry, melanopic …) is done on the **mean spectrum** of the group by the same engine that analyses library LEDs.

### 2.2 Two pages, one store {#how-store}

Both pages use the IndexedDB database `led-spectrum-lab-measurements`. Changes are announced between tabs (BroadcastChannel, the `storage` event, and a 2 s poll as fallback). The header chip "saved in this browser" shows that the database is available. If it says *NOT saved* the browser blocks the database (private window?): export your data manually.

### 2.3 Units, flux factor G and the 380–730 nm range {#how-units}

The i1 Pro measures **irradiance at its sensor** (mW/m²/nm), not the total light of an LED.

* Without extra information the tool reports **illuminance in lux** (where the Lab says "lm") and **irradiance in mW/m²** (where it says "mW"). A banner on the overview says so.
* To get **lumens and watts** of the LED itself, set the **flux factor G (m²)**: total flux = irradiance × G. Choose in *Measurements → Flux conversion*: Lambertian source at distance d (G = π·d²), isotropic (4π·d²), or a custom value. A single group can override the global setting. In a goniometer or integrating sphere set G from your calibration.
* **Efficacy (lm/W)** needs electrical power. If you enter current and voltage, power = I × V is used. If G is unknown the tool uses *illuminance per watt* (lx/W) instead, which is fine to compare operating points of the same LED at the same distance.
* The instrument covers **380–730 nm**. Outside that the spectrum is treated as zero. For red LEDs with a long tail, tick **"extend falling red tail to 780 nm"** in the Measurements tab. It continues an obviously falling tail with an exponential decay before CRI, TM-30 and lumens are computed. Deep-red and far-red LEDs beyond 730 nm cannot be measured.

### 2.4 From 128 pixels to a spectrum: the kernel {#how-kernel}

The i1 Pro has **128 pixels**, 3.1–3.6 nm apart; each pixel sees a band 6–10 nm wide. The spectrum you see is a weighted sum of the pixels: the weights are the **kernel**. Finer than the pixel spacing is interpolation, not extra information: a 5 nm LED line always looks about 10 nm wide.

| Kernel / preset | When to use |
|---|---|
| **LED lines: 1 nm, ArgyllCMS interpolation** (default) | Best for LED spectra: no extra smoothing, closest colour for narrow lines. |
| Standard 10 nm (36 bands) | Exactly the ArgyllCMS / spotread numbers. |
| High resolution 3.33 nm | ArgyllCMS `-H` grid. |
| Fine 1 nm (factory) | The 36 factory bands interpolated: widest kernel, makes narrow lines about 14 nm wide and shifts their colour (a 525 nm line: Δx +0.004, Δy −0.008). Fine for broadband light. |
| Custom | Any grid and kernel: ArgyllCMS filter, factory, windowed sinc, triangle, Gaussian; width and interpolation. |

Tested with simulated lights: every kernel preserves power within about 1 %, noise is the same, broad phosphor LEDs agree to Δx,Δy < 0.0005 whatever you choose. The Instrument tab's **Compare kernels** button draws one of your own measurements with five kernels. The 128 raw pixel values are stored with every shot, so the original data is never lost.

### 2.5 Calibrations {#how-cal}

| Calibration | What it does | When |
|---|---|---|
| **Dark** | Subtracts the sensor's dark signal (modelled from two readings, valid for any exposure). | Before every session; again after 20–30 min or when the room temperature changes. Required. |
| **Source (black-body) correction** | *Shape* calibration: you measure a lamp of known colour temperature (tungsten halogen about 2856 K, or your own reference CSV) and the tool derives a multiplier per band so that the instrument shows that shape. Scale-free; applies to later measurements while ON. | When you want to correct a colour tilt of the instrument. Limited by how good the lamp is (100 K off the rated temperature = a colour tilt in every measurement). |
| **Black-body at several temperatures** | For a lamp whose temperature you can change but not know exactly. Capture ≥ 3 temperatures, fit; optionally enter the true temperature of one step (anchor). Can be used as source correction. | Calibration without a certified lamp. The steps in 1/T are exact; the absolute values need an anchor. |
| **Absolute level** | One factor for the whole spectrum: from a luminance (cd/m²) or irradiance meter, from a laser line (power and beam area) or entered directly. **Match lux meter** (measure page, quick settings) does the same from an illuminance reading. | When you need real lux / mW/m². |

Corrections only affect **new** measurements. Each shot records which correction and kernel it was taken with.

### 2.6 What is calculated {#how-calc}

Colorimetry on the CIE 1931 2° and 1964 10° observers (1 nm grid); CCT and Duv from the nearest point of the Planckian locus in CIE 1960 uv; CRI (CIE 13.3-1995, R1–R14); TM-30-20 (Rf, Rg, hue-bin metrics, 99 CES); photometry (photopic, scotopic); alpha-opic and melanopic quantities (CIE S 026, DER and EDI); photon flux (PPF 400–700 nm, ePAR 400–750 nm); spectral quality (SSI, band coverage, smoothness, narrowest peak). Treat the results as engineering estimates and check them against calibrated references for anything that matters.

---

## 3. The measure page {#measure}

### 3.1 Instrument card {#m-instrument}

Connect / Demo / Disconnect, the **Dark calibration** button and the age of the dark calibration, small chips that show whether the **source correction** and **absolute level** are on and which **kernel** is used, and a shortcut to **Calibration & settings** (the Instrument tab). The status line shows what the instrument is doing.

### 3.2 Measure card {#m-measure}

* **● Measure × N shots**: N separate shots into the active group. **Stop** ends a series.
* **▶ Live**: continuous readings (averaging time from *Quick settings*); the analysis shows the live spectrum ("Live preview, not saved"). **Save live shot** keeps the current spectrum in the group.
* **Quick settings**: live averaging time, **Match lux meter** (enter the reading of a lux meter pointed at the same light, press the button: all future measurements are scaled).
* **Demo light** (demo only): choose the simulated LED and its drive current. Type the same current into the group to make plots.
* Exposure, averaging time, targets and everything else are set in the **Instrument** tab and apply to every shot.

Shortcuts: **Space** measures (when no field has the focus); the **button on the instrument** measures too.

### 3.3 Group card {#m-group}

Choose the active group, **+ New** (empty group) or **Next condition** (same LED, voltage, temperature, tags; type the next current). Fill in *group name, LED / device, current, voltage, temperature, electrical power, flux factor G, tags, note* and any own fields (e.g. "supply", "heatsink"). The list shows the latest shots with include checkboxes, **◎** (show this shot alone) and **✕** (delete); **Undo last shot** removes the newest; **Show group mean** returns to the mean.

### 3.4 The Instrument tab {#m-instrument-tab}

The complete original i1 Pro console:

* **Light / Pigment** mode (pigments use the instrument's own lamp and a white-tile calibration; they stay in the console).
* **Advanced settings**: exposure (auto with target counts and longest time, or manual integration time), *Resolution and output* (presets, custom grid, kernel, width, interpolation; **Compare kernels**), *Live recording and averaging* (rolling or cumulative mean, update interval, time plots, CSV), *Calibrate against a known source*, *Calibrate the absolute level*, *Blackbody at several temperatures*, *Calibration data (EEPROM)* (export, import, back to the instrument's own), *Readout and display* (peak labels, valleys), *Instrument info and diagnostics*, Linux setup.
* The console has its own **measurement table** (tick rows to draw, rename by double-click, export CSV / .sp / ArgyllCMS values / JSON). With the option *"Also add every measurement made here to the active group"* (on by default) light measurements taken in the console also become shots of the active group. **Add to active group** sends ticked rows later; **Analyse ▸** shows one in the Lab's analysis.

---

## 4. The analysis tabs {#analysis}

All tabs analyse the **Source** chosen in the header (live preview, the active group, the latest shot, any group, an LED or the mix). The **Illuminance (lx)** field sets the level for the melanopic EDI of LED sources.

| Tab | Shows |
|---|---|
| **Overview** | KPI cards (CCT, Duv, CRI, TM-30, flux, efficacy, melanopic DER, SSI …), spectrum and chromaticity. |
| **Spectrum** | The spectrum in mW/nm, µmol/s/nm or normalised, log axis, fill, overlay of V(λ), V′(λ), melanopic and cone curves; **Auto labels** for peaks and valleys; zoom with the wheel, pan by dragging, double-click resets. |
| **CIE diagram** | Chromaticity in xy or u′v′ (2° or 10°), the Planckian locus, point table. |
| **CRI** | R1–R14 bars and the test-colour table. |
| **TM-30** | Colour vector graphic, Rf,h, Rcs,h, Rhs,h, the 99 CES and the hue-bin table. |
| **Spectral quality** | SSI, band coverage, smoothness, peaks. |
| **Photometry** | Luminous, scotopic and radiant quantities, efficacy, band shares, photon flux. |
| **Melanopic & sensitivities** | Alpha-opic irradiance, DER and EDI. |

### 4.1 Comparing two sources {#compare}

Pick the second spectrum in the header: **Compare**. It can be *none*, the TM-30 reference illuminant, D65, illuminant A, the mix, any LED of the library **or any measured group**. Then:

* **Every tab** gets a **comparison table** with the measurements of both sources side by side, A (analysed source, blue) and B (compare, grey), and the difference **B − A**: peak wavelength(s), peak width (FWHM), centroid, dominant wavelength, purity, CCT, Duv, x y, u′ v′, CRI, R9, TM-30 Rf / Rg, flux or illuminance, LER, S/P, melanopic DER and EDI, SSI, smoothness … The Overview lists all, other tabs the relevant ones. **Δu′v′** is the colour distance (about 0.002 is just visible side by side, 0.004–0.006 clearly visible). Hover a row for its meaning.
* **Charts show B too**: dashed grey in the spectrum, a grey point in the CIE diagram, ◆ markers over the CRI, TM-30 and band bars, a dashed blue polygon in the TM-30 colour vector graphic.
* D65, A and the TM-30 reference are scaled to the lumens of A so they are directly comparable in the plot; measured groups and LEDs keep their own level.

For a bigger picture of **many** groups at once use *Overlay* (spectra) and *X–Y plots* (any quantity vs any other).

### 4.2 Auto labels {#labels}

On the *Spectrum* and *Overlay* tabs the toolbar **Auto labels** marks **peaks ▲** and **valleys ▼** with their wavelength (sub-nanometre, parabola through the top) and optionally the height. **Max** is the number per trace, **prominence %** how far a peak or valley must stand out from its surroundings (relative to the highest point), **min. spacing nm** merges close labels, **smooth nm** averages before searching (raise it for noisy spectra). Valleys are searched only between the outermost peaks. By default only the main trace is labelled; **all traces** labels every trace (can be crowded). The Instrument tab's chart has the same (number, prominence, valleys).

---

## 5. Measurements, Overlay and X–Y plots {#library}

### 5.1 Measurements tab {#t-meas}

The list of all groups with CCT, illuminance, shot count and the operating point; tick rows to select them for the Overlay and X–Y plots. Click a row to edit it on the right.

* **Edit** name, LED, current, voltage, power, temperature, G, tags, note, extra fields (+ field adds your own, for example "supply voltage"; it becomes a metric you can plot).
* **Shots** of the group: include/exclude, move to another group (for example a mis-assigned shot), delete.
* **Make active** sends new measurements to this group; **Analyse ▸** shows it in the analysis tabs; **→ LED library** adds the mean spectrum to the LED library (so it can be used in mixes; asks for the flux if G is unknown).
* **Import…** / **Export**: JSON with everything (groups, shots, raw pixels), summary CSV of all groups, spectra CSV. **Merge** combines ticked groups into one (all shots are kept); **Delete** removes groups and their shots.

### 5.2 Overlay {#t-overlay}

Spectra of the ticked groups on top of each other, plus their chromaticity. **Scale**: absolute, normalised to peak, equal illuminance (100 lx) or equal power, to compare shape or level. **Individual shots** shows the shots behind each mean. Use it to see how peak wavelength and shape change with current or temperature.

### 5.3 X–Y plots {#t-xy}

Any quantity against any other, one point per group (the mean of its shots).

* **Quick plots**: flux vs current, efficacy vs current, Duv vs flux, CCT vs current, CRI vs current, peak λ vs current / temperature, flux vs temperature …
* **X / Y / Y2**: any metric: set-up fields (current, voltage, power, temperature, your own fields), light output, efficacy, colour (CCT, Duv, x, y, u′, v′, dominant λ), spectrum (peak λ, FWHM), CRI R1–R14, TM-30, circadian. Y2 adds a right-hand axis.
* **Curves per** LED / first tag / one curve. **Normalise Y** to the maximum or to the first point (for example droop curves). Lines, markers, **error bars** (±1σ of the shots), group names, log axes, Y from 0.
* Click a point to select its group in the Measurements tab. **PNG** and **CSV** export the plot and its data.
* Needs the relevant fields: efficacy needs current and voltage (or power); lumens need G. The message above the plot says what is missing.

---

## 6. The LED library and the mixer {#lab}

The original Lab on `lab.html`: a library of LEDs (the built-in ones are **synthetic**, replace them with measured spectra), create one with **+ New LED** (peak wavelength and width, or a CCT for a white pc-LED, or import a CSV), add LEDs to the **mix** with ＋ and set quantity, drive current and scale per channel; the mix is analysed like any source. *Export* writes library, mix or LED as `.json`; spectra can be imported as CSV (wavelength, intensity). Flux is assumed linear in current with no thermal shift.

---

## 7. Files and backup {#files}

| File | Content |
|---|---|
| Measurements JSON | groups, shots, raw pixels, settings; re-importable (Import…). |
| Summary CSV | one row per group with all metrics. |
| Spectra CSV | the mean spectra of the groups. |
| Console exports | CSV (chosen resolution), `.sp` (ArgyllCMS), ArgyllCMS values (36 bands, 3.33 nm), pixels CSV, JSON of the console table, EEPROM `.bin` / hex. |

---

## 8. Troubleshooting {#trouble}

| Problem | What to do |
|---|---|
| "No WebUSB" | Use Chrome or Edge on desktop. |
| "Access denied / unable to claim" | Close ArgyllCMS / spotread or another tab; Linux: install the udev rule (`udev/55-i1pro.rules`) and re-plug; Windows: bind WinUSB (for example with Zadig). |
| Timeout | The driver resets and retries once. Use a short cable, no hub. *Instrument tab → Advanced → Instrument info → Copy diagnostic log*. |
| "Saturated" | Move away from the light, shorten a manual integration time, lower the auto target. |
| "Frames varied" / flicker | PWM-dimmed light: use a longer averaging time or several shots. |
| Weak signal | Move closer, longer *Longest auto time*. |
| Lab page does not update | Open both pages from the same address (same folder) in the same browser profile; "saved in this browser" must show in the header. |
| Numbers in lx / mW/m² instead of lm / mW | Set the flux factor G (see 2.3). |

---

## 9. Limits {#limits}

* The i1 Pro Rev A–D is supported (not i1Pro 2 / Rev E). Reflective mode, live mode, the instrument button and the absolute scale have so far only been tested against the simulator.
* The instrument covers 380–730 nm; optical resolution is about 6.5 nm; widths of narrow lines are broader than real.
* The absolute scale of the factory calibration is assumed (mW/m²/nm), not verified. Calibrate against a reference for real numbers.
* Source correction cannot be better than the lamp. A tilt of the instrument's colour response cannot be told apart from a shift of all temperatures without an anchor temperature.
* Flux is irradiance × G: geometry (distance, angle, diffuser) must be the same as at calibration.

---

## 10. Glossary {#glossary}

* **CCT**: correlated colour temperature, the temperature of the black body that looks most like the light (meaningful only near the locus).
* **Duv**: distance from the Planckian locus; + greenish, − pinkish.
* **CRI Ra / R9**: colour rendering index (mean of 8 samples / saturated red). Unreliable for narrow-band LEDs.
* **TM-30 Rf / Rg**: fidelity and gamut indices; **Rcs,h1** the red chroma shift.
* **LER**: lumens per watt of radiated power. **WPE**: radiant power / electrical power.
* **Melanopic DER / EDI**: melanopic efficacy relative to D65 / the equivalent D65 illuminance.
* **FWHM**: full width at half maximum of a peak.
* **Δu′v′**: colour difference in the CIE 1976 diagram.
* **Shot**: one reading. **Group**: shots of one condition, shown as their mean.
