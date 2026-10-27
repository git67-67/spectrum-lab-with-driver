/* LED Spectrum Lab - help text for the measurement workflow
 * SPDX-License-Identifier: AGPL-3.0-or-later */
(function () {
'use strict';
var A = window.APP, h = A.h, T = A.tabs, orig = T.about.build;
T.about.build = function (root) {
  var self = this; orig.call(self, root);
  var card = h('div', { class: 'card doc' },
    h('h3', null, 'Measuring (i1 Pro) and the measurement store'),
    h('ul', null,
      h('li', null, h('b', null, 'Two pages, one store: '), 'measure.html takes the measurements, lab.html analyses them. Both keep their data in the same browser database (IndexedDB) and update each other within a moment, so you can measure on one screen and watch CRI, TM-30, spectrum and colour on the other. Open both from the same place (same folder or the same web address) in the same browser profile.'),
      h('li', null, h('b', null, 'Instrument tab (measure page): '), 'the complete original i1 Pro console. Source (black-body) correction against a tungsten lamp or your own reference CSV, black-body at several temperatures (fit the true temperatures, use as correction), absolute level (cd/m², mW/m², laser line, factor), resolution presets and custom kernels (ArgyllCMS, factory, sinc, triangle, Gaussian, interpolation), exposure control, live averaging and time plots, pigments (reflective mode with white-tile calibration), EEPROM backup/import and diagnostics. Whatever is set there is used for every shot taken with the Measure button; measurements made in the console itself are added to the active group too (switchable).'),
      h('li', null, h('b', null, 'Auto labels: '), 'on the Spectrum and Overlay tabs, "Auto labels" marks the strongest peaks (▲) and the valleys between them (▼) with their wavelength, optionally with the height. Prominence (how far a peak must stand out), spacing, smoothing and the maximum number are adjustable; by default only the main trace is labelled. The Instrument tab has the same for its own chart (number, prominence, valleys).'),
      h('li', null, h('b', null, 'Which kernel? '), 'The 128 pixels are turned into a spectrum by a kernel. Tested on simulated narrow and broad lights: all kernels preserve the power within about 1 %, noise is the same, but the factory kernel (36 bands) is the widest and shifts the colour of narrow lines (a 525 nm line: Δx +0.0044, Δy −0.0077) while the ArgyllCMS 1 nm interpolation (default "LED lines" preset) or a 5 nm sinc stays within Δx +0.0016, Δy −0.0026. For broad phosphor LEDs all kernels agree to < 0.0005. The Instrument tab can draw the five main kernels over your own measurement.'),
      h('li', null, h('b', null, 'Shot → group: '), 'every press of Measure adds a shot to the active group. The group is shown as ONE measurement (the mean spectrum of its included shots); tick/untick shots to leave outliers out, or open the group to see every individual shot. Nothing is thrown away.'),
      h('li', null, h('b', null, 'Operating point: '), 'give the group a name, the LED it belongs to, current (mA), voltage (V), temperature (°C), notes and any fields of your own. You can also do this later on the analysis page. "Next condition" starts a new group with the same LED and asks for the next current.'),
      h('li', null, h('b', null, 'Curves: '), 'groups of the same LED at different current / voltage / temperature are compared in the X–Y tab (any quantity against any other, e.g. flux vs current, Duv vs flux, with error bars from the shots) and in the Overlay tab (spectra and chromaticity of several groups).'),
      h('li', null, h('b', null, 'Units: '), 'the i1 Pro measures spectral irradiance (mW/m²/nm) at the sensor, so out of the box you get illuminance in lux and irradiance in mW/m². For lumens, watts and efficacy set the flux factor G (m², Φ = E × G): for example a Lambertian LED measured at distance d has G = π·d². Without G, relative curves (flux vs current etc.) are still correct as long as the geometry does not change.'),
      h('li', null, h('b', null, 'Range: '), 'the instrument covers 380–730 nm; the spectrum is taken as zero elsewhere. For white LEDs with a long red tail you can enable "extend falling red tail" (Measurements tab), which continues the tail to 780 nm before the colour metrics are computed.'),
      h('li', null, h('b', null, 'Shortcuts: '), 'Space or the button on the instrument takes the measurement. Live mode shows the spectrum continuously without saving; "Save live shot" keeps the current one.'),
      h('li', null, h('b', null, 'Backups: '), 'Measurements → Export writes everything (including the raw sensor pixels) to a .json file that can be imported again. The browser database is not a backup: clearing site data deletes it.')));
  root.appendChild(card);
};
})();
