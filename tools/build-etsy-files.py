#!/usr/bin/env python3
"""Rebuild the Etsy download files in etsy/ (Start-Here.pdf, Quick-Guide.pdf).

    python3 tools/build-etsy-files.py

Edit APP_URL / the text below, run it, and commit the PDFs. Plain one-page
PDFs with Helvetica, no dependencies. The wallpaper zip is built separately.
"""
from pathlib import Path

PRODUCT = 'Calo'
APP_URL = 'https://caloplanner.com'
OUT = Path(__file__).resolve().parent.parent / 'etsy'


def esc(s):
    return s.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')


def pdf(lines, link=None):
    body = ['BT', '/F1 18 Tf', '72 740 Td']
    for i, line in enumerate(lines):
        if i:
            body.append('0 -22 Td')
        body.append(f'({esc(line)}) Tj')
    body.append('ET')
    stream = '\n'.join(body) + '\n'
    annots = ' /Annots [6 0 R]' if link else ''
    objs = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >>{annots} >>',
        f'<< /Length {len(stream.encode("latin-1"))} >>\nstream\n{stream}endstream',
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ]
    if link:
        url, rect = link
        objs.append(f'<< /Type /Annot /Subtype /Link /Rect [{rect}] /Border [0 0 0] /A << /Type /Action /S /URI /URI ({esc(url)}) >> >>')
    out = '%PDF-1.4\n'
    offsets = []
    for n, o in enumerate(objs, 1):
        offsets.append(len(out.encode('latin-1')))
        out += f'{n} 0 obj\n{o}\nendobj\n'
    xref = len(out.encode('latin-1'))
    out += f'xref\n0 {len(objs) + 1}\n0000000000 65535 f \n'
    out += ''.join(f'{o:010d} 00000 n \n' for o in offsets)
    out += f'trailer << /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'
    return out.encode('latin-1')


start = [
    PRODUCT,
    'Welcome. This is a one-time digital download.',
    'No physical item is shipped.',
    'Open the app:',
    APP_URL,
    'Your unlock code comes in your Etsy order message.',
    'It works on up to 3 of your devices.',
    'Tip: add Calo to your home screen first,',
    'then open it and enter your code.',
    'iPhone: tap Share, Add to Home Screen,',
    'turn on Open as Web App, then Add.',
    'Android: browser menu, Install app.',
    'Laptop: browser menu, Install app, or bookmark it.',
    'Your plans stay on your device. No account.',
]
# The link box sits over the URL line (5th line: 740 - 4*22 = 652).
(OUT / 'Start-Here.pdf').write_bytes(pdf(start, (APP_URL, '72 646 540 672')))

guide = [
    f'{PRODUCT} quick guide',
    'Easy +5, Medium +10, Hard +20.',
    'Day complete +10 when at least two tasks are done.',
    'Level 2 is 40 points. Level 10 is 1180.',
    'A streak counts when you finish one task.',
    'The day starts at 4:00 AM. One rest day a week.',
    'Back up from Customize. It takes a moment.',
    'Reminders usually arrive on time.',
]
(OUT / 'Quick-Guide.pdf').write_bytes(pdf(guide))
print('Wrote', OUT / 'Start-Here.pdf', 'and', OUT / 'Quick-Guide.pdf')
