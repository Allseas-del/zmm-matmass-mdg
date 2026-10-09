"""Append the column AESZN (document change number, MARA-AESZN) to the Basic Data sheet of a Migration Cockpit
template file (XML Spreadsheet 2003), in place. The Migration Cockpit template "Product" has no AESZN, the Product
API has it (Product.ProductDocumentChangeNumber, DS4 $metadata 9 Oct 2026); the tool maps the column to that property.

Usage: python add_aeszn_column.py <template.xml> [<template.xml> ...]
"""
import sys

from add_stawn_column import add_column

FIELD = "AESZN"
TYPE = "ETE;6;0;C;6;0"
GROUP = "Allseas: document data"
DESCRIPTION = ("Document change no. (MARA-AESZN)\n\nAllseas extension: not in the Migration Cockpit template; written and "
               "read through the Product API (ProductDocumentChangeNumber). Max 6 characters; # clears the field.")

if __name__ == "__main__":
    for path in sys.argv[1:]:
        raw = open(path, encoding="utf-8").read()
        out, col = add_column(raw, "Basic Data", FIELD, TYPE, GROUP, DESCRIPTION)
        if out != raw:
            open(path, "w", encoding="utf-8", newline="").write(out)
        print(f"{path}: {FIELD} is column {col}{'' if out != raw else ' (already present)'}")
