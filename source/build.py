#!/usr/bin/env python3
"""Build lab.html and measure.html from the module sources.
   python build.py [out_dir]
The original LED Spectrum Lab modules (src/) are patched in memory by patch_base.py, then the measurement modules (mod/) and,
for measure.html, the i1 Pro driver (i1pro/) are appended. Each output is one self-contained HTML file."""
import pathlib, subprocess, sys
root = pathlib.Path(__file__).resolve().parent
out = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else root / 'dist'
out.mkdir(parents=True, exist_ok=True)
subprocess.check_call([sys.executable, '-I', str(root / 'patch_base.py')], cwd=root)
subprocess.check_call([sys.executable, '-I', str(root / 'patch_i1ui.py')], cwd=root)
rd = lambda p: (root / p).read_text(encoding='utf-8')
base_js = [rd('src/data.js'), rd('src/core.js'), rd('build/ui1_state.js'), rd('build/ui2_charts.js'), rd('src/ui3_library.js'), rd('build/ui4_tabs.js')]
meas_js = [rd('mod/help.js'), rd('mod/labels.js'), rd('mod/compare.js'), rd('mod/meas_core.js'), rd('mod/meas_ui.js'), rd('mod/meas_about.js')]
import json
i1_js = [rd('i1pro/i1pro-core.js'), rd('i1pro/i1pro-sim.js'), rd('i1pro/demo-eeprom.js'), rd('i1pro/i1pro-plot.js'),
         'window.I1P_VIEW=' + json.dumps(rd('build/measure-view.html')).replace('</', '<\\/') + ';', rd('build/i1pro-ui.js')]
import markdown
gmd = rd('docs/GUIDE.md').replace('[TOC]', '')
ghtml = markdown.markdown(gmd, extensions=['attr_list', 'tables', 'fenced_code', 'sane_lists'])
guide_js = 'window.LSL_GUIDE=' + json.dumps(ghtml).replace('</', '<\\/') + ';'
meas_js.insert(0, guide_js)
css = rd('src/style.css') + '\n' + rd('mod/extra.css')
BOOT = ("try{APP.M.init().then(function(){APP.init()}).catch(function(e){document.getElementById('app').textContent='Startup error: '+e.message;console.error(e)})}"
        "catch(e){document.getElementById('app').textContent='Startup error: '+e.message;console.error(e)}")
def page(kind, title, scripts):
    s = ['<!doctype html>\n<!-- LED Spectrum Lab (%s) - AGPL-3.0-or-later. Built by build.py from the module sources. -->\n' % kind,
         '<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">\n<title>%s</title>\n<style>%s</style></head>\n' % (title, css),
         '<body><div id="app"><p style="padding:20px">Loading…</p></div><div id="toasts"></div>\n<noscript>This tool needs JavaScript.</noscript>\n',
         '<script>window.LSL_PAGE=%r;</script>\n' % kind, '<script>%s</script>\n' % rd('src/meta.js')]
    for j in scripts:
        assert '</script' not in j.lower(), 'script end tag inside a module'
        s.append('<script>%s\n</script>\n' % j)
    s.append('<script>%s</script>\n</body></html>\n' % BOOT)
    return ''.join(s)
(out / 'lab.html').write_text(page('lab', 'LED Spectrum Lab – analysis', base_js + meas_js + [rd('mod/page_lab.js')]), encoding='utf-8')
(out / 'measure.html').write_text(page('measure', 'LED Spectrum Lab – measure', base_js + i1_js + meas_js + [rd('mod/page_measure.js')]), encoding='utf-8')
(out / 'GUIDE.md').write_text(gmd, encoding='utf-8')
(out / 'GUIDE.html').write_text('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LED Spectrum Lab guide</title><style>body{font:15px/1.55 system-ui,sans-serif;max-width:860px;margin:0 auto;padding:20px 16px;color:#222}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:3px 8px}code{background:#eee;padding:0 3px}h2{margin-top:2em;border-bottom:1px solid #ccc}</style></head><body>' + ghtml + '</body></html>', encoding='utf-8')
print('built', [(p.name, p.stat().st_size) for p in sorted(out.glob('*.html'))])
