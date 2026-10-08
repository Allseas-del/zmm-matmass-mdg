# Custom service for the commodity code (MARC-STAWN)

The released Product APIs do not carry the commodity code: on DS4 (8 Oct 2026) neither `API_PRODUCT_2` (V4,
entity `ProductPlantInternationalTrade`: country/region of origin, CAS number, PRODCOM number, consumption tax
code) nor `API_PRODUCT_SRV` (V2, `A_ProductPlantIntlTrd`) has a property for `MARC-STAWN`. MM02/MM03 hide the
field and MM17 does not offer it either. The app therefore writes the column `STAWN` of the Plant Data sheet
through this small ABAP service, which calls `BAPI_MATERIAL_SAVEDATA` with `PLANTDATA-COMM_CODE`.

## Objects (package ZMM_MATMASS, same transport as the app)

| Object | Name | Source |
|---|---|---|
| Class | `ZCL_MM_MATMASS_STAWN` (interface `IF_HTTP_EXTENSION`) | `zcl_mm_matmass_stawn.clas.abap` (paste in ADT or SE24 source-based) |
| ICF node | `/sap/bc/zmm_matmass/stawn` | SICF: under `default_host/sap/bc` create sub-node `zmm_matmass` (type "independent service"), then `stawn`; tab *Handler List*: `ZCL_MM_MATMASS_STAWN`; tab *Logon Data*: standard (launchpad session / SAML); activate both nodes |

No OData, no Gateway registration, no CDS: the handler reads JSON and answers JSON.

## Interface

CSRF protection (the node uses the launchpad session, so without it another web page opened in the same browser could
post here with the user's rights):

```
GET  /sap/bc/zmm_matmass/stawn          header X-CSRF-Token: Fetch   -> 200, response header X-CSRF-Token: <token>
POST /sap/bc/zmm_matmass/stawn          header X-CSRF-Token: <token>, Content-Type: application/json
     without/expired token -> 403 + X-CSRF-Token: Required (the app fetches a new token and retries once)
     other Content-Type     -> 415
```

The handler uses `IF_HTTP_SERVER~GET_XSRF_TOKEN` and `~VALIDATE_XSRF_TOKEN`; check their signature in SE24 on DS4 before
activating (parameter names can differ per release).


```
POST /sap/bc/zmm_matmass/stawn?sap-client=410
{ "items": [ { "material": "5000000", "plant": "AF00", "commodityCode": "84099900" } ] }

200
{ "items": [ { "material": "5000000", "plant": "AF00", "commodityCode": "84099900",
               "previous": "741521 00", "changed": true, "type": "S", "message": "Material 5000000 changed" } ] }
```

- `commodityCode` `""` clears the code (the app sends this for a `#` cell).
- One BAPI call and commit per item; a rejected item (`type` `E`) does not stop the others.
- After the commit the handler reads `MARC-STAWN` again and reports `changed` from the database. If the BAPI
  accepts the field but does not update it in this S/4HANA release (SAP note 2267246, foreign trade fields in the
  material master), the item comes back as `E` with that text. That is the first thing to verify on DS4.
- Authorizations: the user needs change authorization for the material master plant data (`M_MATE_WRK` activity
  02 and the usual `M_MATE_*` objects); the handler checks `M_MATE_WRK` up front, the BAPI checks the rest.
- The app calls the service after the product's V4 change set, because the BAPI moves the product's change
  timestamp, which the V4 API uses as ETag.

## Test from a terminal

```
curl -u USER -c c.txt -H "X-CSRF-Token: Fetch" -D - "https://vhlruds4ci.sap.allseas.global:44300/sap/bc/zmm_matmass/stawn?sap-client=410"
curl -u USER -b c.txt -H "X-CSRF-Token: <token from the first call>" -X POST "https://vhlruds4ci.sap.allseas.global:44300/sap/bc/zmm_matmass/stawn?sap-client=410" ^
  -H "Content-Type: application/json" ^
  -d "{\"items\":[{\"material\":\"5000000\",\"plant\":\"AF00\",\"commodityCode\":\"84099900\"}]}"
```

Then `SE16N` on `MARC` (MATNR 5000000, WERKS AF00) shows the new value; MM03 does not show the field.

## Template

The column `STAWN` is an Allseas addition to the Plant Data sheet of the Migration Cockpit template (row 5 field
name, row 6 type `ETE;80;0;C;80;0`, row 7 group *Allseas: customs*, row 8 description). `test/add_stawn_column.py`
appends it to any template file; the example template of the app (`webapp/template_product.xml`) and the unit-test
file already have it as column 147. The Migration Cockpit itself ignores the extra column.
