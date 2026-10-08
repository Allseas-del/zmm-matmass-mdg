"""Append the Allseas column STAWN (commodity code, MARC-STAWN) to the Plant Data sheet of a Migration Cockpit
template file (XML Spreadsheet 2003), in place. The tool reads the field name from row 5, the type from row 6 and
the description from row 8 of the sheet; the column is written by the custom service, not by the Product API.

Usage: python add_stawn_column.py <template.xml> [<template.xml> ...]
"""
import re
import sys
from xml.sax.saxutils import escape

FIELD = "STAWN"
TYPE = "ETE;80;0;C;80;0"
GROUP = "Allseas: customs"
DESCRIPTION = ("Commodity Code (MARC-STAWN)\n\nAllseas extension: the mass upload app writes this column through the custom "
               "service ZMM_MATMASS_STAWN (BAPI_MATERIAL_SAVEDATA, plant data COMM_CODE), not through the Product API. "
               "Digits and spaces, max 17 characters; # clears the code.")
_ROW = re.compile(r"<Row\b.*?</Row>", re.S)


def add_column(text: str, sheet: str, field: str, type_str: str, group: str, description: str) -> tuple[str, int]:
    """Returns (new text, 1-based column of the field). No change when the field exists already."""
    i = text.find(f'ss:Name="{sheet}"')
    if i < 0:
        raise KeyError(sheet)
    start = text.find("<Table", i)
    end = text.find("</Table>", start)
    table = text[start:end]
    rows = list(_ROW.finditer(table))
    # existing columns from the field-name row (row 5); the new column follows the last field
    col, last = 0, 0
    for m in re.finditer(r"<Cell\b([^>]*)>(?:<Data[^>]*>(.*?)</Data>)?", rows[4].group(0), re.S):
        idx = re.search(r'ss:Index="(\d+)"', m.group(1))
        col = int(idx.group(1)) if idx else col + 1
        if (m.group(2) or "").strip() == field:
            return text, col
        if (m.group(2) or "").strip():
            last = col
    n = last + 1
    m = re.search(r'ss:ExpandedColumnCount="(\d+)"', table)   # SAP's templates carry 999 here; keep the larger value
    if m and int(m.group(1)) < n:
        table = table[: m.start()] + f'ss:ExpandedColumnCount="{n}"' + table[m.end():]
    cols = list(re.finditer(r"<Column\b[^>]*/>", table))
    last = cols[-1]
    style = re.search(r'ss:StyleID="([^"]+)"', last.group(0))
    col_el = f'\n   <Column ss:Index="{n}"' + (f' ss:StyleID="{style.group(1)}"' if style else "") + ' ss:Width="120"/>'
    table = table[: last.end()] + col_el + table[last.end():]
    rows = list(_ROW.finditer(table))
    texts = {4: field, 5: type_str, 6: group, 7: description}
    for r in sorted(texts, reverse=True):          # from the last row backwards so earlier offsets stay valid
        row = rows[r]
        cells = re.findall(r"<Cell\b([^>]*?)/?>", row.group(0))
        last_style = None
        for attrs in reversed(cells):
            s = re.search(r'ss:StyleID="([^"]+)"', attrs)
            if s:
                last_style = s.group(1)
                break
        cell = (f'<Cell ss:Index="{n}"' + (f' ss:StyleID="{last_style}"' if last_style and r >= 6 else "")
                + f'><Data ss:Type="String">{escape(texts[r])}</Data></Cell>')
        close = row.group(0).rfind("</Row>")
        table = table[: row.start() + close] + cell + table[row.start() + close:]
    return text[:start] + table + text[end:], n


if __name__ == "__main__":
    for path in sys.argv[1:]:
        raw = open(path, encoding="utf-8").read()
        out, col = add_column(raw, "Plant Data", FIELD, TYPE, GROUP, DESCRIPTION)
        if out != raw:
            open(path, "w", encoding="utf-8", newline="").write(out)
        print(f"{path}: {FIELD} is column {col}{'' if out != raw else ' (already present)'}")
